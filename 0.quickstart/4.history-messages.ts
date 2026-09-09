import {AIMessage} from "@langchain/core/messages";
import {createAgent} from "langchain";
import {MemorySaver} from "@langchain/langgraph";
import {model} from "../tools/utils.ts";

const agent = createAgent({
    model: model,
    tools: [],
    checkpointer: new MemorySaver(),
});

const config1 = {configurable: {thread_id: crypto.randomUUID()}};
const config2 = {configurable: {thread_id: crypto.randomUUID()}};

await agent.invoke(
    {messages: [{role: "user", content: "My name is Luke and my age is 66"},],},
    config1,
);

await agent.invoke(
    {messages: [{role: "user", content: "My name is Zebra and my age is 88"},],},
    config2,
);

let result = await agent.invoke(
    {messages: [{role: "user", content: "What is my name and my age?"}]},
    config1,
);
console.log(result.messages.at(-1)?.content)

result = await agent.invoke(
    {messages: [{role: "user", content: "What is my name and my age?"}]},
    config2,
);
console.log(result.messages.at(-1)?.content)