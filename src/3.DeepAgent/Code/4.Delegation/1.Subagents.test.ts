import {createAgent, tool} from "langchain";
import {CompiledSubAgent, createDeepAgent, type SubAgent} from "deepagents";
import {z} from "zod";
import {test} from 'vitest'
import {model} from '../../../tools/utils.ts'
import {getWeather} from "../../../1.LangChain/1.core-components/4.tool.test.ts";
import type {ToolRuntime} from "@langchain/core/tools";
import {HumanMessage} from "@langchain/core/messages";

test('SubAgent', async () => {
    const researchSubagent: SubAgent = {
        name: "research-agent",
        description: "Used to research more in depth questions",
        systemPrompt: "You are a great researcher",
        tools: [getWeather],
        model: model,
    };
    const subagents = [researchSubagent];

    const agent = createDeepAgent({
        model: "google:gemini-3.6-flash",
        subagents,
    });
})

test('CompiledSubAgent', async () => {
    const researchInstructions = "You are a research coordinator.";
    const yourModel = "google:gemini-3.6-flash";
    const specializedTools: never[] = [];

    const customGraph = createAgent({
        model: yourModel,
        tools: specializedTools,
        systemPrompt: "You are a specialized agent for data analysis...",
    });

    const customSubagent: CompiledSubAgent = {
        name: "data-analyzer",
        description: "Specialized agent for complex data analysis tasks",
        runnable: customGraph,
    };

    const subagents = [customSubagent];

    const agent = createDeepAgent({
        model: "openai:gpt-5.5",
        tools: [getWeather],
        systemPrompt: researchInstructions,
        subagents: subagents,
    });
})

test('Forked subagents', async () => {
    const readDiff = tool(
        async ({path}: { path: string }) => `diff for ${path}`,
        {
            name: "read_diff",
            description: "Read a file's diff",
            schema: z.object({path: z.string()}),
        },
    );

    const commentWriter = {
        name: "comment-writer",
        description: "Continues an in-progress PR review and drafts review comments",
        mode: "fork" as const,
        tools: [readDiff],
    };

    const agent = createDeepAgent({
        model: "anthropic:claude-sonnet-4-6",
        tools: [readDiff],
        subagents: [commentWriter],
    });

    const result = await agent.invoke({
        messages: [
            {
                role: "user",
                content:
                    "Review PR #482 and hand it off to comment-writer to draft comments for the issues found",
            },
        ],
    });
})

test('SubAgent Access Context', async () => {
    const contextSchema = z.object({
        userId: z.string(),
        sessionId: z.string(),
    });

    const getUserData = tool(
        async (input, runtime: ToolRuntime<unknown, typeof contextSchema>) => {
            // Access Main Agent's Context
            const userId = runtime.context?.userId;
            return `Data for user ${userId}: ${input.query}`;
        },
        {
            name: "get_user_data",
            description: "Fetch data for the current user",
            schema: z.object({query: z.string()}),
        },
    );

    const researchSubagent = {
        name: "researcher",
        description: "Conducts research for the current user",
        systemPrompt: "You are a research assistant.",
        tools: [getUserData],
    };

    const agent = createDeepAgent({
        model: "openai:gpt-5.5",
        subagents: [researchSubagent],
        contextSchema,
    });

    const result = await agent.invoke(
        {messages: [new HumanMessage("Look up my recent activity")]},
        {context: {userId: "user-123", sessionId: "abc"}},
    );
})

test('Which Subagent Called Tool', async () => {
    const sharedLookup = tool(
        async (input, runtime: ToolRuntime) => {
            // 获取调用Tool的Agent的name
            const agentName = runtime.config?.metadata?.lc_agent_name;
            console.log(agentName);
        },
        {
            name: "shared_lookup",
            description: "Look up information from various sources",
            schema: z.object({ query: z.string() }),
        },
    );
})