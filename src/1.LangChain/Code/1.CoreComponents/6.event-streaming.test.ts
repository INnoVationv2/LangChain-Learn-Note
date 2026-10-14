import {test, beforeAll} from 'vitest'
import {getSunnyWeather} from "./4.tool.test.ts";
import {createAgent, ReactAgent, tool} from "langchain";
import {HumanMessage} from "@langchain/core/messages";
import {model} from "./2.model.test.ts";
import {logMetadata, logToolCall} from "../../../tools/utils.ts";
import {z} from "zod";

let weatherAgent: ReactAgent

beforeAll(async () => {
    weatherAgent = createAgent({
        name: 'weather_agent',
        model: model,
        tools: [getSunnyWeather],
    });
})

test('EventStream Demo', async () => {
    const stream = await weatherAgent.streamEvents(
        {messages: [new HumanMessage('What is the weather in NY?')]},
        // 使用新版流式接口，指定version: "v3"
        // 返回AgentRunStream，方便按消息、Tool调用等分类读取运行过程。
        {version: "v3"}
    );

    // 可通过stream event获取stream每一步执行的细节。
    console.log('Stream Messages:');
    for await (const msg of stream.messages) {
        console.log(`   Message Text: ${await msg.text}`)
        console.log(`   Reasoning: ${await msg.reasoning}`)
        logToolCall(await msg.toolCalls)
        logMetadata(await msg.usage)
        console.log(`   Output: ${JSON.stringify(await msg.output)}`)
    }

    console.log('Stream Values:')
    for await (const value of stream.values)
        console.log('   Value: ' + JSON.stringify(value));

    console.log('Stream Subgraphs:')
    for await (const subgraph of stream.subgraphs)
        console.log('   subgraph: ' + JSON.stringify(subgraph));

    console.log('Stream Tool Calls:')
    for await (const toolCall of stream.toolCalls)
        console.log('   Tool Call: ' + JSON.stringify(toolCall));

    // Agent最终状态
    console.log(`finalState: ${JSON.stringify(await stream.output)}`);
}, 600_000)

// 流式打印Subagent的消息
test('Stream Subagents', async () => {
    const callWeather = tool(
        async ({query}) => {
            const result = await weatherAgent.invoke({
                messages: [new HumanMessage(query)],
            });
            return result.messages.at(-1)?.text ?? "";
        },
        {name: "call_weather", schema: z.object({query: z.string()})}
    );

    const supervisor = createAgent({
        model: model,
        tools: [callWeather],
        name: "supervisor",
    });

    const stream = await supervisor.streamEvents(
        {messages: [{role: "user", content: "What's the weather in Boston?"}]},
        {version: "v3"}
    );

    for await (const subagent of stream.subagents) {
        process.stdout.write(`${subagent.name}: `);
        for await (const message of subagent.messages)
            for await (const token of message.text)
                process.stdout.write(token);
        process.stdout.write("\n");
    }
})

test('Concurrent Consume', async () => {
    const stream = await weatherAgent.streamEvents(
        {messages: [new HumanMessage('What is the weather in NY?')]},
        {version: "v3"}
    );

    await Promise.all([
        (async () => {
            for await (const message of stream.messages)
                console.log(await message.text);
        })(),
        (async () => {
            for await (const call of stream.toolCalls)
                console.log(call.name, call.input);
        })(),
    ]);
})
