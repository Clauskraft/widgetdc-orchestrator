from openai import OpenAI
from tools import AVAILABLE_TOOLS, TOOL_DESCRIPTIONS
from prompts import SYSTEM_PROMPT, REFLECTION_PROMPT
import re
import os

class AgenticWorker:
    def __init__(self, model_name="gpt-4o-mini"):
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.model_name = model_name

    def call_llm(self, messages):
        response = self.client.chat.completions.create(
            model=self.model_name,
            messages=messages
        )
        return response.choices[0].message.content

    def parse_action(self, text):
        # PATTERN: Routing (Chapter 2)
        # Multi-format parser — LLMs produce tool calls in various syntaxes

        # Format 1: Action: tool_name Input: value  (original spec format)
        m = re.search(r"Action:\s*(\w+)\s+Input:\s*(.*?)(?:\n|$)", text, re.IGNORECASE)
        if m and m.group(1) in AVAILABLE_TOOLS:
            return m.group(1), m.group(2).strip()

        # Format 2: Action: tool_name("value") or Action: tool_name('value')
        m = re.search(r"Action:\s*(\w+)\s*\(\s*[\"']?([^\"')]*)[\"']?\s*\)", text, re.IGNORECASE)
        if m and m.group(1) in AVAILABLE_TOOLS:
            return m.group(1), m.group(2).strip()

        # Format 3: tool_name("value") anywhere in the text (LLM writes Python directly)
        for tool_name in AVAILABLE_TOOLS:
            m = re.search(rf'\b{tool_name}\s*\(\s*[\"\'](.*?)[\"\']\s*\)', text)
            if m:
                return tool_name, m.group(1).strip()

        # Format 4: tool_name() with no argument (e.g. get_current_date()) — BEFORE code blocks
        for tool_name in AVAILABLE_TOOLS:
            m = re.search(rf'\b{tool_name}\s*\(\s*\)', text)
            if m:
                return tool_name, ""

        # Format 5: Markdown code block (```python ... ```) → route to execute_code (last resort)
        code_block = re.search(r'```(?:python)?\s*([\s\S]+?)```', text)
        if code_block:
            return "execute_code", code_block.group(1).strip()

        return None, None

    def reflect_on_output(self, task, answer, tool_observations: list = None):
        # PATTERN: Reflection (Chapter 4)
        # Inkluder tool-observationer så Critic kan validere mod reel tool-output
        obs_context = ""
        if tool_observations:
            obs_context = "\n\nVærktøjs-output fra sessionen (FAKTUELLE DATA — stol på disse):\n"
            obs_context += "\n".join(f"  • {o}" for o in tool_observations)

        critic_messages = [
            {"role": "user", "content": REFLECTION_PROMPT.format(task=task, answer=answer) + obs_context}
        ]
        critique = self.call_llm(critic_messages)

        if "APPROVED" in critique.upper():
            return True, "Svaret er godkendt af Critic."
        return False, critique

    def run(self, task):
        print(f"\n🚀 Starter agent for opgave: '{task}'")

        # Initialiser prompt med værktøjsbeskrivelser
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT.format(tools=TOOL_DESCRIPTIONS)},
            {"role": "user", "content": task}
        ]

        tool_observations: list = []
        max_steps = 5
        for step in range(max_steps):
            print(f"\n--- Step {step + 1} ---")

            # 1. Generer Thought og Action (Chain of Thought)
            response_text = self.call_llm(messages)
            print(f"🤖 Agent: {response_text}")

            # 2. Parsing og Routing — tool call takes priority over FINISHED
            action_name, action_input = self.parse_action(response_text)

            # 3. Execution (Tool Use) — check BEFORE FINISHED so hallucinated loops don't win
            if action_name in AVAILABLE_TOOLS:
                print(f"🛠️ Kaldet værktøj: {action_name} med input: {action_input}")
                fn = AVAILABLE_TOOLS[action_name]
                tool_output = fn() if action_input == "" else fn(action_input)
                tool_observations.append(f"{action_name}({action_input!r}) → {tool_output}")

                # Føj til historik
                messages.append({"role": "assistant", "content": response_text})
                messages.append({"role": "user", "content": f"Observation: {tool_output}"})

            elif "FINISHED" in response_text.upper():
                # Ingen tool call — agent er færdig, kør reflection
                final_answer = re.sub(r'FINISHED:\s*', '', response_text, flags=re.IGNORECASE).strip()
                is_approved, feedback = self.reflect_on_output(task, final_answer, tool_observations)

                if is_approved:
                    return final_answer
                else:
                    print(f"🛑 Critic afviste: {feedback}")
                    messages.append({"role": "assistant", "content": response_text})
                    messages.append({"role": "user", "content": f"Dit svar blev afvist. {feedback}. Prøv igen."})

            else:
                # Ingen tool call og ingen FINISHED — agent tænker, lad den fortsætte
                messages.append({"role": "assistant", "content": response_text})
                messages.append({"role": "user", "content": "Fortsæt. Brug et af de tilgængelige værktøjer, eller afslut med FINISHED: [svar]."})
                if not action_name:
                    print(f"⏳ Ingen action fundet — nudger agent...")

        return "Agenten nåede max steps uden at løse opgaven."
