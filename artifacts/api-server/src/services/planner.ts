import { and, desc, eq, sql } from "drizzle-orm";
import { db, plansTable } from "@workspace/db";
import { companyBrain } from "./company-brain";
import { callAI } from "../lib/ai";
import { logger } from "../lib/logger";

export type PlanPhase = {
  name: string;
  weeks: number;
  departments: string[];
  deliverables: string[];
};

export type Plan = {
  id: string;
  goal: string;
  context: string | null;
  phases: PlanPhase[];
  departments: string[];
  risks: string[];
  createdAt: Date;
  updatedAt: Date;
};

class PlannerService {
  async createPlan(input: { goal: string; context?: string }): Promise<Plan> {
    const brainContext = await companyBrain.getContext(input.goal);

    const result = await callAI(
      [
        {
          role: "system",
          content: `You are the FounderOS Planner. Create a structured execution plan for the founder's goal.
Return ONLY a JSON object with this exact schema:
{
  "phases": [
    {"name": "string", "weeks": number, "departments": ["string"], "deliverables": ["string"]}
  ],
  "departments": ["string"],
  "risks": ["string"]
}

Rules:
- Phases must be sequential, total weeks realistic (typically 4-16).
- Each phase names the departments involved.
- Deliverables are concrete, measurable outcomes.
- Departments list is deduplicated across all phases.
- Risks are specific, actionable concerns.`,
        },
        {
          role: "user",
          content: `Goal: ${input.goal}

Context: ${input.context ?? "None provided."}

Company Brain Context:
${brainContext}

Generate the plan now.`,
        },
      ],
      { jsonMode: true },
    );

    const parsed = JSON.parse(result.reply) as {
      phases: PlanPhase[];
      departments: string[];
      risks: string[];
    };

    const [plan] = await db
      .insert(plansTable)
      .values({
        goal: input.goal,
        context: input.context ?? null,
        phases: parsed.phases,
        departments: parsed.departments,
        risks: parsed.risks,
      })
      .returning();

    return {
      ...plan,
      phases: parsed.phases,
      departments: parsed.departments,
      risks: parsed.risks,
    };
  }

  async listPlans(): Promise<Plan[]> {
    return db.select().from(plansTable).orderBy(desc(plansTable.createdAt));
  }

  async getPlan(id: string): Promise<Plan | null> {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, id)).limit(1);
    return plan ?? null;
  }
}

export const planner = new PlannerService();