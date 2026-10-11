import {createAgent} from "langchain";
import {CompiledSubAgent, createDeepAgent, type SubAgent} from "deepagents";
import {z} from "zod";
import {test} from 'vitest'
import {model} from '../../../tools/utils.ts'
import {getWeather} from "../../../1.LangChain/1.core-components/4.tool.test.ts";

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