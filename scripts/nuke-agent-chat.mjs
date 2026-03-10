#!/usr/bin/env node
/**
 * Nuke Agent CLI — Chat with the fine-tuned vehicle domain LLM
 *
 * Usage:
 *   npm run nuke:chat                          # interactive mode
 *   npm run nuke:ask -- "What is YONO?"        # single question
 *   npm run nuke:ask -- --pipe < questions.txt  # pipe mode
 *
 * Requires NUKE_AGENT_URL env var (set after `modal deploy yono/modal_nuke_agent_serve.py`)
 * Falls back to `modal run` for one-off questions if no server is deployed.
 */

import readline from "readline";

const AGENT_URL = process.env.NUKE_AGENT_URL;
const SYSTEM_PROMPT =
  "You are Nuke Agent, the AI assistant for the Nuke vehicle data platform. " +
  "You have deep knowledge of collector vehicles, auction markets, data pipelines, " +
  "and the Nuke platform architecture. Be concise, accurate, and actionable.";

const history = [{ role: "system", content: SYSTEM_PROMPT }];

async function askAgent(messages) {
  if (!AGENT_URL) {
    console.error(
      "NUKE_AGENT_URL not set. Deploy first:\n" +
        "  modal deploy yono/modal_nuke_agent_serve.py\n" +
        "  export NUKE_AGENT_URL=$(modal app show nuke-agent-serve --url)\n\n" +
        "Or run a one-off question:\n" +
        "  modal run yono/modal_nuke_agent_serve.py --question 'your question'"
    );
    process.exit(1);
  }

  const res = await fetch(`${AGENT_URL}/api_chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, max_tokens: 1024, temperature: 0.7 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Agent error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "(no response)";
}

async function singleQuestion(question) {
  history.push({ role: "user", content: question });
  const answer = await askAgent(history);
  history.push({ role: "assistant", content: answer });
  console.log(answer);
}

async function interactiveChat() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[36mnuke>\x1b[0m ",
  });

  console.log("\x1b[1mNuke Agent\x1b[0m — domain LLM for collector vehicle intelligence");
  console.log("Type your question, or 'exit' to quit.\n");

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input === "exit" || input === "quit" || input === ".q") {
      rl.close();
      return;
    }
    if (input === "/clear") {
      history.length = 1; // keep system prompt
      console.log("(conversation cleared)");
      rl.prompt();
      return;
    }

    try {
      history.push({ role: "user", content: input });
      process.stdout.write("\x1b[2m...\x1b[0m");
      const answer = await askAgent(history);
      history.push({ role: "assistant", content: answer });
      // Clear the "..." and print answer
      process.stdout.write("\r\x1b[K");
      console.log(`\x1b[33m${answer}\x1b[0m\n`);
    } catch (err) {
      process.stdout.write("\r\x1b[K");
      console.error(`\x1b[31mError: ${err.message}\x1b[0m\n`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nbye.");
    process.exit(0);
  });
}

// --- Main ---
const args = process.argv.slice(2);
const isPipe = args.includes("--pipe");
const questionParts = args.filter((a) => !a.startsWith("--"));
const question = questionParts.join(" ").trim();

if (question) {
  singleQuestion(question).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else if (isPipe || !process.stdin.isTTY) {
  // Read all stdin and answer
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    singleQuestion(input.trim()).catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
  });
} else {
  interactiveChat();
}
