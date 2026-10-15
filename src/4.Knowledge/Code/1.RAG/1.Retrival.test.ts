import {test} from 'vitest';
import {createAgent, HumanMessage, tool} from "langchain";
import * as z from "zod";
import {model} from "../../../tools/utils.ts";

test('Agentic RAG', async () => {
    const ALLOWED_DOMAINS = ["https://langchain-ai.github.io/"];
    const LLMS_TXT = "https://langchain-ai.github.io/langgraph/llms.txt";

    const fetchDocumentation = tool(
        async (input) => {
            if (!ALLOWED_DOMAINS.some((domain) => input.url.startsWith(domain))) {
                return `Error: URL not allowed. Must start with one of: ${ALLOWED_DOMAINS.join(", ")}`;
            }
            const response = await fetch(input.url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        },
        {
            name: "fetch_documentation",
            description: "Fetch and convert documentation from a URL",
            schema: z.object({
                url: z.string().describe("The URL of the documentation to fetch"),
            }),
        }
    );

    const llmsTxtResponse = await fetch(LLMS_TXT);
    const llmsTxtContent = await llmsTxtResponse.text();

    const systemPrompt = `
        You are an expert TypeScript developer and technical assistant.
        Your primary role is to help users with questions about LangGraph and related tools.

        Instructions:

        1. If a user asks a question you're unsure about—or one that likely involves API usage,
        behavior, or configuration—you MUST use the \`fetch_documentation\` tool to consult the relevant docs.
        2. When citing documentation, summarize clearly and include relevant context from the content.
        3. Do not use any URLs outside of the allowed domain.
        4. If a documentation fetch fails, tell the user and proceed with your best expert understanding.

        You can access official documentation from the following approved sources:

        ${llmsTxtContent}

        You MUST consult the documentation to get up to date documentation
        before answering a user's question about LangGraph.

        Your answers should be clear, concise, and technically accurate.`;

    const tools = [fetchDocumentation];

    const agent = createAgent({
        model: model,
        tools,
        systemPrompt,
        name: "Agentic RAG",
    });

    const response = await agent.invoke({
        messages: [
            new HumanMessage(
                "Write a short example of a langgraph agent using the " +
                "prebuilt create react agent. the agent should be able " +
                "to look up stock pricing information."
            ),
        ],
    });

    console.log(response.messages.at(-1)?.content);
});