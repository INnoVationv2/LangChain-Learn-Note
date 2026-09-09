import {createAgent, tool} from 'langchain';
import * as z from 'zod';
import {model} from "../tools/utils.ts";


const getWeather = tool(
    (input) => `It's always sunny in ${input.city}!`
    , {
        name: "get_weather",
        description: "Get the weather for a given city",
        schema: z.object({
            city: z.string().describe("The city to get the weather for"),
        }),
    }
);


const agent = createAgent({
    model: model,
    tools: [getWeather]
})


const msg = await agent.invoke({
    messages: [{role: "user", content: "What's the weather in San Francisco?"}]
})

console.log(msg.messages[3].content)
