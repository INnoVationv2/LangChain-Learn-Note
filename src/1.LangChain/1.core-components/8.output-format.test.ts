import * as z from "zod";
import {createAgent, providerStrategy, toolStrategy} from "langchain";
import {unthinkingModel} from "../../tools/utils.ts";
import {getWeather} from "./4.tool.test";
import {HumanMessage} from "@langchain/core/messages";
import {test} from 'vitest'
import {ToolInputParsingException} from "@langchain/core/tools";

// responseFormat有两种方式格式化输出:
// 1.providerStrategy: 由大模型直接生成格式化消息
// 2.toolStrategy: LangChain提供格式化tool, 大模型返回参数, tool实现格式化
// 如果不指定策略,会动态选择
test('format output', async () => {
    // 指定输出格式
    const weatherDetailSchema = z.object({city: z.string(), weather: z.string()})
    const agent = createAgent({
        model: unthinkingModel,
        tools: [getWeather],
        responseFormat: weatherDetailSchema,
        // responseFormat: providerStrategy(weatherDetailSchema),
        // responseFormat: toolStrategy(weatherDetailSchema),
    });

    const output = await agent.invoke(
        {messages: [new HumanMessage('How is the weather of NY?')]},
        {
            callbacks: [{
                handleChatModelStart(_llm, _messages, _runId, _parentRunId, extra) {
                    const params = extra?.invocation_params as | { tools?: unknown } | undefined;
                    // 在此处打断点,可以观察tool list
                    console.log(params?.tools, {depth: null});
                }
            }]
        }
    );

    console.dir(JSON.stringify(output.messages), {depth: null});
    console.log(output.structuredResponse);
}, 600_000)

// toolMessageContent: 会将toolStrategy执行完成后生成的结果替换成toolMessageContent
// 比如下例: 大模型调用格式化输出tool,tool格式化后返回结果给大模型
//          大模型返回格式化结果作为格式化输出, 到达lang chain后,
//          会将message的content替换为toolMessageContent,
//          但是structuredResponse不会改变
test('Custom ToolStrategy', async () => {
    const weatherDetailSchema = z.object({city: z.string(), weather: z.string()})
    const agent = createAgent({
        model: unthinkingModel,
        tools: [getWeather],
        responseFormat: toolStrategy(weatherDetailSchema, {
            toolMessageContent: "Hello From responseFormat/toolStrategy/ToolMessageContent"
        })
    });

    // 打断点观察最后一条消息的content和structuredResponse
    const messages = await agent.invoke({messages: [new HumanMessage('How is the weather of NY?')]});
    let msg = messages.messages.at(-2)!
    console.log(`Type:${msg.type}, Content:${msg.content}`);
    msg = messages.messages.at(-1)!
    console.log(`Type:${msg.type}, Content:${msg.content}`);
    console.log(messages.structuredResponse);
})

// 多个输出Schema错误: 当模型调用多个结构化输出tool时，Agent会提供错误反馈
test('Multi Schema Error', async () => {
    const weatherDetailSchema_1 = z.object({city: z.string(), weather: z.string()})
    const weatherDetailSchema_2 = z.object({city: z.string(), temperature: z.number()})

    const agent = createAgent({
        model: unthinkingModel,
        tools: [],
        responseFormat: toolStrategy([weatherDetailSchema_1, weatherDetailSchema_2])
    });

    const messages = await agent.stream(
        {messages: [new HumanMessage("Extract Info: NY today's weather is sunny and temperature is 38")]},
        {streamMode: ['values']}
    );

    // 注意报错后最后一条消息的错误信息
    // The model has called multiple tools: extract-1, extract-2 to return a structured output.
    // This is not supported. Please provide a single structured output.
    for await (const msg of messages)
        console.log(JSON.stringify(msg));
}, 6000_000)

// Schema验证错误: 并不存在
test('Schema Type Error', async () => {
    const weatherDetailSchema =
        z.object({
            city: z.string(),
            temperature: z.number().min(0).max(30)
                .describe('temperature from 0~30'),
        })

    const agent = createAgent({
        model: unthinkingModel,
        tools: [],
        responseFormat: toolStrategy(weatherDetailSchema)
    });

    const messages = await agent.invoke(
        {messages: [new HumanMessage("Extract Info: NY today's temperature is 38")]},
    );

    // message其中一条包含错误信息, 不一定每次都会打印
    // Failed to parse structured output for tool 'extract-1':
    // Property temperature does not match schema. 38 is greater than 30
    console.log(messages);
}, 6000_000)


const weatherDetailSchema = z.object({
    city: z.string(),
    temperature: z.number().min(0).max(30).describe('temperature from 0~30'),
})

// 自定义错误消息
test('Custom Error Message', async () => {
    let agent = createAgent({
        model: unthinkingModel,
        tools: [],
        responseFormat: toolStrategy(weatherDetailSchema, {
            handleError: 'Please provide a valid temperature between 0~30'
        })
    });

    let messages = await agent.invoke(
        {messages: [new HumanMessage("Extract Info: NY today's temperature is 38")]},
    );

    // 解析时会包含错误信息handleError, 不一定每次都会打印
    console.log(messages);
}, 6000_000)


// 仅处理特定种类Error, 可增加处理Error的种类
test('Custom Error Handle Type', async () => {
    const responseFormat = toolStrategy(weatherDetailSchema, {
        handleError: (error) => {
            if (error instanceof ToolInputParsingException)
                return 'Please provide a valid temperature between 0~30'
            return error.message;
        }
    })

    const agent = createAgent({
        model: unthinkingModel,
        tools: [],
        responseFormat: responseFormat
    });

    const messages = await agent.invoke(
        {messages: [new HumanMessage("Extract Info: NY's temperature is 68")]},
    );

    // 同上, 解析时会包含错误信息, 不一定每次都会打印
    console.log(messages);
}, 6000_000)

//关闭Error处理, 遇到error就抛出
const responseFormat = toolStrategy(weatherDetailSchema, {
    handleError: false
})