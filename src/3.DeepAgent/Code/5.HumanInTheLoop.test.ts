import {HITLRequest, tool} from 'langchain';
import {createDeepAgent} from 'deepagents';
import {MemorySaver} from '@langchain/langgraph';
import {v7 as uuid7} from 'uuid';
import {Command} from '@langchain/langgraph';
import {test} from 'vitest'
import {model} from '../../tools/utils.ts';
import {HumanMessage} from '@langchain/core/messages';
import {getRainingWeather, getSunnyWeather} from '../../1.LangChain/1.core-components/4.tool.test.ts';

const checkpointer = new MemorySaver();
const agent = createDeepAgent({
    model: model,
    tools: [getSunnyWeather, getRainingWeather],
    interruptOn: {
        [getSunnyWeather.name]: true,
        // 等价于:
        // [getWeather.name]: {allowedDecisions: ['approve', 'edit', 'reject']},
    },
    checkpointer, // Required!
});

test('Add Interrupt', async () => {
    const config = {configurable: {thread_id: uuid7()}};
    let result = await agent.invoke({
        messages: [new HumanMessage('How is the weather of NY')],
    }, config);

    if (result.__interrupt__) {
        const interrupts = result.__interrupt__[0].value as HITLRequest;
        const actionRequests = interrupts.actionRequests;
        const reviewConfigs = interrupts.reviewConfigs;

        const configMap = Object.fromEntries(
            reviewConfigs.map((cfg) => [cfg.actionName, cfg])
        );

        for (const action of actionRequests) {
            const reviewConfig = configMap[action.name];
            console.log(`Tool: ${action.name}`);
            console.log(`Arguments: ${JSON.stringify(action.args)}`);
            console.log(`Allowed decisions: ${reviewConfig.allowedDecisions}`);
        }

        const decisions = [
            {
                type: 'reject',
                message: 'User rejected get weather. Do not retry again.',
            }
        ];

        result = await agent.invoke(
            new Command({resume: {decisions}}),
            config
        );
    }

    console.log(result.messages[result.messages.length - 1].content);
})

test('Edit Interrupt', async () => {
    const config = {configurable: {thread_id: uuid7()}};
    let result = await agent.invoke({
        messages: [new HumanMessage('How is the weather of NY')],
    }, config);

    if (result.__interrupt__) {
        const decisions = [
            {
                type: 'edit',
                editedAction: {
                    // 修改成其他Tool
                    name: getRainingWeather.name,
                    args: {city: 'Peking'},
                }
            }
        ];

        result = await agent.invoke(
            new Command({resume: {decisions}}),
            config
        );
    }

    console.log(result.messages[result.messages.length - 1].content);
})