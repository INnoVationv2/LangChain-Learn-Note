import {test} from 'vitest';
import {createDeepAgent} from "deepagents";
import {model} from "../../tools/utils.ts";
import {HumanMessage} from "@langchain/core/messages";

test('DeepAgent Quickstart Demo', async () => {
    const systemPrompt =
        ['You are an expert researcher. Your job is to conduct thorough research and then write a polished report.',
            'You have access to an internet search tool as your primary means of gathering information.',
            '## \`internet_search\`',
            'Use this to run an internet search for a given query. You can specify the max number of results to return, ' +
            'the topic, and whether raw content should be included.'].join('\n');

    // 使用LLM内置的Server端网络搜索工具
    const internetSearch = {type: "web_search_preview"};
    const deepAgent = createDeepAgent({
        model: model,
        tools: [internetSearch],
        systemPrompt: systemPrompt,
    });

    const result = await deepAgent.invoke({
        messages: [new HumanMessage('What is langgraph?')],
    });

    console.log(result.messages.at(-1)?.content);
});

