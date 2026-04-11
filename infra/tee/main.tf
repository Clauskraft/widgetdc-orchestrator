# infra/tee/main.tf — TEE Pillar 1 Provisioning
# GCP Confidential Computing (AMD EPYC SEV-SNP)
# Satisfies: sov_access_policy = 'TEE_REQUIRED' (ADR-003, widgetdc-spec v0.1)
#
# Deploy:
#   terraform init
#   terraform apply -var="project=<gcp-project-id>"

variable "project" {
  description = "GCP Project ID"
  type        = string
}

variable "zone" {
  description = "GCP zone for TEE node"
  type        = string
  default     = "europe-west4-a"  # EU residency — GDPR Art.44 compliance
}

provider "google" {
  project = var.project
  region  = "europe-west4"
}

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
  description = "Internal IP of the TEE node (mount as context_fold endpoint)"
  value       = google_compute_instance.tee_node.network_interface[0].network_ip
}

output "tee_node_self_link" {
  description = "GCP self-link for attestation verification"
  value       = google_compute_instance.tee_node.self_link
}
