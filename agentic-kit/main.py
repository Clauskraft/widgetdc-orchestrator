# main.py
from agent import AgenticWorker
import os
import sys

if __name__ == "__main__":
    if not os.getenv("OPENAI_API_KEY"):
        print("❌ Fejl: Sæt OPENAI_API_KEY som env var — eksempel:")
        print("  $env:OPENAI_API_KEY='sk-proj-...'  # PowerShell")
        print("  export OPENAI_API_KEY='sk-proj-...'  # bash")
        sys.exit(1)

    # Initialiser agenten
    agent = AgenticWorker(model_name="gpt-4o-mini")

    # Eksempler på opgaver der tester forskellige patterns
    opgaver = [
        "Hvad handler bogen 'Agentic Design Patterns' om? Brug search værktøjet.",
        "Hvad er kvadratroden af 144 ganget med 2? Brug execute_code.",
        "Hvilken dato er det i dag?"
    ]

    for opgave in opgaver:
        resultat = agent.run(opgave)
        print("\n" + "="*50)
        print(f"✅ Endeligt Resultat: {resultat}")
        print("="*50 + "\n")
