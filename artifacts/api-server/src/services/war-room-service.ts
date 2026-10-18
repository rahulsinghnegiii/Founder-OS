import { agentRuntime, type AgentExecutionResult } from "./agent-runtime";
import { memoryService } from "./memory-service";
import { callAI } from "../lib/ai";
import { logger } from "../lib/logger";
import { publishOperationalEvent } from "../lib/event-bus";
import { logActivity } from "../lib/activity-logger";

export type WarRoomSession = {
  objective: string;
  departments: string[];
  priority: "low" | "medium" | "high" | "urgent";
};

export type WarRoomResult = {
  objective: string;
  agentContributions: AgentExecutionResult[];
  synthesis: string;
  strategicDebate?: string;
  finalPlan: string[];
};

class WarRoomService {
  async initiateCollaboration(session: WarRoomSession): Promise<WarRoomResult> {
    logger.info({ objective: session.objective }, "Initiating War Room session");

    const memoryContext = await memoryService.buildContextBlock({
      query: session.objective,
      limit: 8,
    });

    const founderProfile = await memoryService.getFounderProfile();

    publishOperationalEvent("warroom.session.started", {
      objective: session.objective,
      departments: session.departments,
    });

    // 1. Parallel execution of department agents
    const contributions = await Promise.all(
      session.departments.map((dept) =>
        agentRuntime.executeDelegation({
          department: dept,
          objective: session.objective,
          priority: session.priority,
          context: `Multi-agent collaboration session (War Room). Founder Profile context included.`,
          memoryContext: `${memoryContext}\n\nFounder Strategic Profile:\n${founderProfile}`,
          relatedEntities: [],
          trigger: "war_room",
        })
      )
    );

    // 2. Strategic Synthesis & Debate Simulation
    try {
      const agentSummaries = contributions
        .map((c) => `[${c.department} Agent]: ${c.summary}\nNext Steps: ${c.nextSteps.join(", ")}`)
        .join("\n\n");

      const result = await callAI(
        [
          {
            role: "system",
            content: `You are the War Room Synthesizer for FounderOS. Your job is to take independent agent contributions and synthesize them into a single, cohesive strategic plan.
            Resolve any cross-departmental conflicts. Align the execution with the founder's long-term profile.
            Return a JSON object:
            {
              "synthesis": "A high-level strategic overview of the unified approach.",
              "strategicDebate": "A brief summary of any departmental trade-offs or friction points considered.",
              "finalPlan": ["Step 1...", "Step 2...", "..."]
            }`,
          },
          {
            role: "user",
            content: `Objective: ${session.objective}\n\nAgent Contributions:\n${agentSummaries}\n\nFounder Profile:\n${founderProfile}`,
          },
        ],
        { jsonMode: true }
      );

      const data = JSON.parse(result.reply);

      const warRoomResult: WarRoomResult = {
        objective: session.objective,
        agentContributions: contributions,
        synthesis: data.synthesis,
        strategicDebate: data.strategicDebate,
        finalPlan: data.finalPlan,
      };

      await logActivity({
        entityType: "war_room",
        action: "collaboration_completed",
        actorType: "system",
        actorName: "War Room Synthesizer",
        details: {
          objective: session.objective,
          departments: session.departments,
          planSteps: data.finalPlan.length,
        },
      });

      publishOperationalEvent("warroom.session.completed", {
        objective: session.objective,
        synthesis: data.synthesis,
      });

      return warRoomResult;
    } catch (err) {
      logger.error({ err }, "War Room synthesis failed");
      return {
        objective: session.objective,
        agentContributions: contributions,
        synthesis: "The War Room session completed but the synthesis layer failed. Individual agent contributions are available for review.",
        finalPlan: contributions.flatMap((c) => c.nextSteps),
      };
    }
  }
}

export const warRoomService = new WarRoomService();
