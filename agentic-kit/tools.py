import random

# PATTERN: Tool Use (Chapter 5)
# Agenten får adgang til disse funktioner for at interagere med omverdenen.

def search_knowledge_base(query: str) -> str:
    """Søger efter information i en database."""
    return f"🔍 Søger efter '{query}'... Resultat: 'Agentic Design Patterns' er en bog af Antonio Gulli, der dækker 21 patterns."

def execute_code(code: str) -> str:
    """Eksekverer python kode."""
    # I produktion bør dette køre i en sandbox
    import math, datetime
    try:
        local_ns: dict = {"math": math, "datetime": datetime}
        # Single expression → eval (returns value directly)
        if '\n' not in code.strip() and '=' not in code:
            result = eval(code, {"math": math, "datetime": datetime})
            return f"💻 Resultat: {result}"
        # Multi-line / statements → exec, then read 'result' or last assigned name
        exec(code, local_ns)
        # Try to return 'result' variable, else last non-dunder key
        if 'result' in local_ns:
            return f"💻 Resultat: {local_ns['result']}"
        user_vars = [v for k, v in local_ns.items() if not k.startswith('_') and k not in ('math', 'datetime')]
        return f"💻 Resultat: {user_vars[-1] if user_vars else 'Executed (ingen output variable)'}"
    except Exception as e:
        return f"❌ Fejl ved eksekvering: {str(e)}"

def get_current_date() -> str:
    """Henter dagens dato."""
    import datetime
    return datetime.datetime.now().strftime("%Y-%m-%d")

# Registry af tilgængelige værktøjer
AVAILABLE_TOOLS = {
    "search_knowledge_base": search_knowledge_base,
    "execute_code": execute_code,
    "get_current_date": get_current_date
}

TOOL_DESCRIPTIONS = """
- search_knowledge_base(query: str): Svarer på generelle spørgsmål og fakta.
- execute_code(code: str): Kører Python kode. Brug dette til beregninger.
- get_current_date(): Returnerer dagens dato.
"""
