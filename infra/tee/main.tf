# infra/tee/main.tf — TEE Provisioning (Phase 3 + Phase 4)
# GCP Confidential Computing (AMD EPYC SEV-SNP)
# Satisfies: sov_access_policy = 'TEE_REQUIRED' (ADR-003, widgetdc-spec v0.1)
#
# Resources:
#   tee_node          — context folding workload (debian-11, Phase 3)
#   tee_node_snout    — Snout ACI ingestor (Confidential Space OS, Phase 4)
#   tee_agent         — least-privilege service account for Snout TEE node
#
# Deploy:
#   terraform init
#   terraform apply -var="project=<gcp-project-id>"

variable "project" {
  description = "GCP Project ID"
  type        = string
}

variable "zone" {
  description = "GCP zone for TEE nodes"
  type        = string
  default     = "europe-west4-a"  # EU residency — GDPR Art.44 compliance
}

provider "google" {
  project = var.project
  region  = "europe-west4"
}

# ── Service Account for Snout TEE node ────────────────────────────────────────

resource "google_service_account" "tee_agent" {
  account_id   = "widgetdc-tee-agent"
  display_name = "WidgeTDC TEE Agent (Snout Ingestor)"
  description  = "Least-privilege SA for Snout ACI ingestor running inside Confidential Space"
}

# Grant only Secret Manager access (vendor credentials, no broader perms)
resource "google_project_iam_member" "tee_agent_secrets" {
  project = var.project
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.tee_agent.email}"
}

# ── TEE Node: Snout ACI Ingestor (Phase 4) ────────────────────────────────────
# Uses GCP Confidential Space OS — purpose-built for TEE workloads.
# Runs snout_ingestor.py in hardware-isolated memory; vendor credentials
# and session tokens never exposed in plain RAM.

resource "google_compute_instance" "tee_node_snout" {
  name         = "widgetdc-tee-snout-ingestor"
  machine_type = "n2d-standard-4"  # AMD EPYC 3rd Gen with SEV-SNP support
  zone         = var.zone

  boot_disk {
    initialize_params {
      # Confidential Space OS — hardened for TEE workloads (replaces debian-11)
      image = "projects/confidential-space/global/images/confidential-space-2-0-0"
      type  = "pd-ssd"
    }
    auto_delete = true
  }

  confidential_instance_config {
    enable_confidential_compute = true
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  # Least-privilege service account — only Secret Manager access
  service_account {
    email  = google_service_account.tee_agent.email
    scopes = ["cloud-platform"]
  }

  network_interface {
    network = "default"
    access_config {}
  }

  metadata = {
    widgetdc-role      = "tee-snout-ingestor"
    widgetdc-phase     = "4"
    sov_data_residency = "EU"
    sov_exec_residency = "EU"
    tee-workload       = "snout-aci"
  }

  tags = ["widgetdc-tee", "snout-ingestor"]
}

# ── TEE Node: Context Fold (Phase 3) ─────────────────────────────────────────
resource "google_compute_instance" "tee_node" {
  name         = "widgetdc-tee-node-01"
  machine_type = "n2d-standard-4" # AMD EPYC with SEV-SNP support
  zone         = var.zone

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-11"
      type  = "pd-ssd"
    }
  }

  # Enable Confidential Computing (SEV-SNP)
  confidential_instance_config {
    enable_confidential_compute = true
  }

  # Shielded VM for integrity monitoring
  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  network_interface {
    network = "default"
    access_config {}
  }

  metadata = {
    widgetdc-role    = "tee-context-fold"
    widgetdc-phase   = "3"
    sov_data_residency = "EU"
    sov_exec_residency = "EU"
  }

  tags = ["widgetdc-tee", "context-fold"]
}

output "tee_node_ip" {
  description = "Internal IP of the TEE context-fold node"
  value       = google_compute_instance.tee_node.network_interface[0].network_ip
}

output "tee_node_self_link" {
  description = "GCP self-link for context-fold attestation verification"
  value       = google_compute_instance.tee_node.self_link
}

output "tee_snout_ip" {
  description = "Internal IP of the Snout ACI ingestor TEE node"
  value       = google_compute_instance.tee_node_snout.network_interface[0].network_ip
}

output "tee_agent_email" {
  description = "Service account email for TEE agent (use in workload identity binding)"
  value       = google_service_account.tee_agent.email
}
