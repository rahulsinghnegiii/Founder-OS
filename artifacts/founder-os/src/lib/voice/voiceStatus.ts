// Client-side heuristics that make the assistant feel alive.
// These derive friendly status messages from the founder's message so the UI
// can show "what the assistant is doing" before the reply arrives. They never
// change what is sent to the backend — only the displayed feedback.

export interface ThinkingStatus {
  /** A short human acknowledgement, e.g. "Okay…". */
  ack: string;
  /** The operation in progress, e.g. "Creating the lead…". */
  status: string;
}

const OPERATION_RULES: Array<{ match: RegExp; verb: string; noun: string }> = [
  { match: /\b(update|edit|change|modify)\b/i, verb: "Updating", noun: "your CRM" },
  { match: /\b(lead|prospect|contact|crm|referral)\b/i, verb: "Creating", noun: "the lead" },
  { match: /\b(project|initiative)\b/i, verb: "Starting", noun: "the project" },
  { match: /\b(task|to-?do)\b/i, verb: "Logging", noun: "the task" },
  { match: /\b(remind|reminder)\b/i, verb: "Setting", noun: "your reminder" },
  { match: /\b(meeting|sync|call with|catch up)\b/i, verb: "Scheduling", noun: "the meeting" },
  { match: /\b(note|remember|jot)\b/i, verb: "Saving", noun: "your note" },
  { match: /\b(team member|teammate|hire|onboard)\b/i, verb: "Adding", noun: "the team member" },
  { match: /\b(department|division)\b/i, verb: "Creating", noun: "the department" },
  { match: /\b(plan|strateg|grow|scale|road ?map|campaign|quarterly)\b/i, verb: "Putting together", noun: "a plan" },
  { match: /\b(report|analytics|metrics|numbers|revenue)\b/i, verb: "Pulling", noun: "your numbers" },
];

export function deriveThinkingStatus(message: string): ThinkingStatus {
  const m = (message || "").trim();

  const isQuestion = /^(what|why|how|who|when|where|which|can you|could you|should|is |are |do (you|we)|does |tell me|explain)/i.test(m) || m.endsWith("?");
  const isGreeting = /^(hi|hey|hello|morning|afternoon|evening|howdy)\b/i.test(m);
  const isCommand = /\b(create|add|new |set |schedule|remind|log|start|send|make)\b/i.test(m);

  let ack = "Okay…";
  if (isGreeting) ack = "Hey…";
  else if (isQuestion) ack = "Sure…";
  else if (isCommand) ack = "On it…";

  let status = "Understanding your request…";
  if (isGreeting) status = "Hello there.";
  else if (isQuestion) status = "Looking through your workspace…";
  else {
    for (const rule of OPERATION_RULES) {
      if (rule.match.test(m)) {
        status = `${rule.verb} ${rule.noun}…`;
        break;
      }
    }
  }

  return { ack, status };
}

export function isQuestionMessage(message: string): boolean {
  const m = (message || "").trim();
  return /^(what|why|how|who|when|where|which|can you|could you|should|is |are |do (you|we)|does |tell me|explain)/i.test(m) || m.endsWith("?");
}
