import {
    SystemMessage,
    HumanMessage,
    ToolMessage,
    AIMessageChunk,
    ContentBlock
} from "@langchain/core/messages";
import {model} from "../../../tools/utils.ts";
import {load} from "@langchain/core/load";
import {test} from "vitest"
import {getSunnyWeather} from "./4.tool.test.ts";

/*
四类消息
    1.System message: 设定模型的行为模式, 基调、定义模型的角色并建立响应准则。
    2.Human Message: 代表用户输入以及与模型的交互
    3.AI Message:  大模型生成的响应，包括文本内容、工具调用和元数据
    4.Tool Message: Tool Call的输出
*/
// 3.AI Message: 大模型生成的响应，包括文本内容、工具调用和元数据
test("Message Demo", async () => {
    // 1.System message:设定模型的行为模式, 基调、定义模型的角色并建立响应准则。
    const systemMsg = new SystemMessage("You are a helpful coding assistant.");
    // 2.Human Message: 代表用户输入, 可以包含文本、图像、音频以及其他多模态内容
    const humanMsg = new HumanMessage("How do I create a REST API?");
    const aiMessage = await model.invoke(
        [systemMsg, humanMsg]
    )
    console.log(typeof aiMessage)
})


// 3.1 Tool Call
test("ToolCallMessage Demo", async () => {
    const modelWithTools = model.bindTools([getSunnyWeather]);
    const response = await modelWithTools.invoke("What's the weather in Paris?");
    const toolCall = response.tool_calls![0]
    console.log(`Tool: ${toolCall.name}`);
    console.log(`Args: ${toolCall.args}`);
    console.log(`ID: ${toolCall.id}`);
})

// 3.2获取此次调用的元数据
test('MetaData Demo', async () => {
    const response = await model.invoke("Hello!");
    const metaData = response.usage_metadata
    console.log(metaData);
})


// 3.3 流式消息
test('Stream Demo', async () => {
    // 收到数据就打印出来
    const stream = await model.stream("Why do parrots have colorful feathers?");
    for await (const chunk of stream) {
        console.log(chunk.text)
    }

    // 收到数据就打印出来, 最后整体打印一遍
    let full: AIMessageChunk | null = null;
    for await (const chunk of stream) {
        full = full ? full.concat(chunk) : chunk;
        console.log(full.text);
    }
    console.log(full!.contentBlocks);
})


// 4.手动创建Tool Message, 必须写明以下字段call_id
const toolMessage = new ToolMessage({
    content: "Sunny, 72°F",
    tool_call_id: "call_123"
});

// ContentBlock
test("ContentBlock Demo", async () => {
    const msgContent: ContentBlock.Text = {
        type: "text",
        "text": "What is this picture?",
    }
    const imageBlock: ContentBlock.Multimodal.Image = {
        type: "image",
        url: "https://example.com/image.png",
        mimeType: "image/png",
    }
    const message = new HumanMessage({
        content: [msgContent, imageBlock],
    });
    console.log(message)
})

// 序列化
test("Serialize Demo", async () => {
    const serialized = new HumanMessage("What is the capital of France?").toJSON();
    const restored = await load<HumanMessage>(JSON.stringify(serialized));
    console.log(restored);
})
