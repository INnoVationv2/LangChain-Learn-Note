import {AIMessage, createAgent} from "langchain";
import {model} from "../tools/utils.ts";

const agent = createAgent({
    model: model
})

const stream = await agent.streamEvents(
    {messages: [{role: "user", content: "Search for AI news and summarize the findings",},],},
    {version: "v3"},
);

for await (const snapshot of stream.values) {
    const message = snapshot.messages.at(-1);
    if (!message) continue;

    if (message.type === "human") {
        console.log(`User: ${message.content}`);
    } else if (AIMessage.isInstance(message)) {
        if (message.content) {
            console.log(`Agent: ${message.content.toString()}`);
        }
        if (message.tool_calls?.length) {
            const names = message.tool_calls.map(tc => tc.name);
            console.log(`Calling tools: ${names.join(", ")}`);
        }
    }
}