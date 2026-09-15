import {interrupt, MemorySaver, StateSchema} from '@langchain/langgraph';
import * as z from 'zod';
import {StateGraph, START, END, type GraphNode, Command} from '@langchain/langgraph';
import {HumanMessage} from '@langchain/core/messages';
import {unthinkingModel} from '../../tools/utils.ts';
import {toolStrategy} from "langchain";

// 定义State
const EmailClassificationSchema = z.object({
    intent: z.enum(['question', 'bug', 'billing', 'feature', 'complex']),
    urgency: z.enum(['low', 'medium', 'high', 'critical']),
    topic: z.string(),
    summary: z.string(),
});

const EmailAgentState = new StateSchema({
    emailContent: z.string(),
    sender: z.string(),
    emailId: z.string(),

    classification: EmailClassificationSchema.optional(),

    searchResults: z.array(z.string()).optional(),
    customerHistory: z.record(z.string(), z.any()).optional(),

    responseText: z.string().optional(),
});

// 这里只是随便实现，实际环境中可以实现邮件阅读逻辑。
function getEmail() {
    return {
        emailContent: 'I was charged twice for my subscription! This is urgent!',
        sender: 'customer@example.com',
        emailId: 'email_123'
    };
}

const llm = unthinkingModel;

// 读取和分类邮件
const readEmail: GraphNode<typeof EmailAgentState> = async (state, config) => {
    // 读取email并写入到state中
    const {emailContent, sender, emailId} = getEmail()
    console.log(`Processing email: ${emailContent}`);
    return new Command({
        update: {emailContent, sender, emailId},
        goto: 'classifyIntent'
    });
}

// 对email进行分类
const classifyIntent: GraphNode<typeof EmailAgentState> = async (state, config) => {
    const structuredLlm = llm.withStructuredOutput(EmailClassificationSchema, {method: "functionCalling"});

    const classificationPrompt = `
    Analyze this customer email and classify it:

    Email: ${state.emailContent}
    From: ${state.sender}

    Provide classification including intent, urgency, topic, and summary.`;

    const classification = await structuredLlm.invoke(classificationPrompt);

    let nextNode: 'searchDocumentation' | 'humanReview' | 'draftResponse' | 'bugTracking';
    // if (classification.intent === 'billing' || classification.urgency === 'critical')
    //     nextNode = 'humanReview';
    if (classification.intent === 'question' || classification.intent === 'feature')
        nextNode = 'searchDocumentation';
    else if (classification.intent === 'bug')
        nextNode = 'bugTracking';
    else
        nextNode = 'draftResponse';

    return new Command({
        update: {classification},
        goto: nextNode,
    });
}

//搜索文档给出答案
const searchDocumentation: GraphNode<typeof EmailAgentState> = async (state, config) => {
    // Search knowledge base for relevant information

    // Build search query from classification
    const classification = state.classification!;
    const query = `${classification.intent} ${classification.topic}`;
    let searchResults: string[];

    try {
        // Implement your search logic here
        // Store raw search results, not formatted text
        searchResults = [
            'Reset password via Settings > Security > Change Password',
            'Password must be at least 12 characters',
            'Include uppercase, lowercase, numbers, and symbols',
        ];
    } catch (error) {
        // For recoverable search errors, store error and continue
        searchResults = [`Search temporarily unavailable: ${error}`];
    }

    return new Command({
        update: {searchResults},
        goto: 'draftResponse',
    });
}

const bugTracking: GraphNode<typeof EmailAgentState> = async (state, config) => {
    const ticketId = 'BUG-12345';  // Would be created via API

    return new Command({
        update: {searchResults: [`Bug ticket ${ticketId} created`]},
        goto: 'draftResponse',
    });
}

// 响应
const draftResponse: GraphNode<typeof EmailAgentState> = async (state, config) => {
    const classification = state.classification!;
    const contextSections: string[] = [];

    if (state.searchResults) {
        const formattedDocs = state.searchResults.map(doc => `- ${doc}`).join('\n');
        contextSections.push(`Relevant documentation:\n${formattedDocs}`);
    }

    if (state.customerHistory) {
        contextSections.push(`Customer tier: ${state.customerHistory.tier ?? 'standard'}`);
    }

    // Build the prompt with formatted context
    const draftPrompt = `
    Draft a response to this customer email:
    ${state.emailContent}

    Email intent: ${classification.intent}
    Urgency level: ${classification.urgency}

    ${contextSections.join('\n\n')}

    Guidelines:
    - Be professional and helpful
    - Address their specific concern
    - Use the provided documentation when relevant
    `;

    const response = await llm.invoke([new HumanMessage(draftPrompt)]);
    const needsReview = (
        classification.urgency === 'high' ||
        classification.urgency === 'critical' ||
        classification.intent === 'complex'
    );

    return new Command({
        update: {responseText: response.content.toString()},  // Store only the raw response
        goto: needsReview ? 'humanReview' : 'sendReply',
    });
}

const humanReview: GraphNode<typeof EmailAgentState> = async (state, config) => {
    const classification = state.classification!;

    // interrupt() must come first
    // !!! any code before it will re-run on resume
    const humanDecision = interrupt({
        emailId: state.emailId,
        originalEmail: state.emailContent,
        draftResponse: state.responseText,
        urgency: classification.urgency,
        intent: classification.intent,
        action: 'Please review and approve/edit this response',
    });

    // Now process the human's decision
    if (humanDecision.approved) {
        return new Command({
            update: {responseText: humanDecision.editedResponse || state.responseText},
            goto: 'sendReply',
        });
    } else {
        return new Command({update: {}, goto: END});
    }
}

const sendReply: GraphNode<typeof EmailAgentState> = async (state, config) => {
    // 实际生产环境中，这里实现发送邮件逻辑。
    console.log(`Sending reply: ${state.responseText!.substring(0, 100)}...`);
    return {};
}

// 连接各个节点
const workflow = new StateGraph(EmailAgentState)
    .addNode('readEmail', readEmail)
    .addNode('classifyIntent', classifyIntent, {
        ends: ['searchDocumentation', 'humanReview', 'draftResponse', 'bugTracking']
    })
    .addNode(
        'searchDocumentation',
        searchDocumentation,
        {retryPolicy: {maxAttempts: 3}},
    )
    .addNode('bugTracking', bugTracking)
    .addNode('draftResponse', draftResponse, {
        ends: ["humanReview", "sendReply"],
    })
    .addNode('humanReview', humanReview)
    .addNode('sendReply', sendReply)
    .addEdge(START, 'readEmail')
    .addEdge('readEmail', 'classifyIntent')
    .addEdge('searchDocumentation', 'draftResponse')
    .addEdge('bugTracking', 'draftResponse')
    .addEdge('humanReview', 'sendReply')
    .addEdge('sendReply', END);

const app = workflow.compile({checkpointer: new MemorySaver()});

// Run with a thread_id for persistence
const config = {configurable: {thread_id: 'customer_123'}};
const result = await app.invoke({}, config);

console.log(`Draft ready for review: ${result.responseText?.substring(0, 100)}...`);

const humanResponse = new Command({
    resume: {
        approved: true,
        editedResponse: "We sincerely apologize for the double charge. I've initiated an immediate refund...",
    }
});

// Resume execution
const finalResult = await app.invoke(humanResponse, config);
console.log('Email sent successfully!');