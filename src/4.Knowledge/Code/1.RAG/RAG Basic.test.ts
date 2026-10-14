import {Document} from '@langchain/core/documents';
import assert from 'node:assert/strict';
import {test} from 'vitest';
import {embeddingModel} from '../../../tools/utils.ts';
import {MemoryVectorStore} from '@langchain/classic/vectorstores/memory';
import {PDFParse} from 'pdf-parse';
import {readFileSync} from 'node:fs';
import {RecursiveCharacterTextSplitter} from '@langchain/textsplitters';

// 1.创建文档
const document = [
    new Document({
        pageContent: 'Dogs are great companions, known for their loyalty and friendliness.',
        metadata: {source: 'mammal-pets-doc'}
    }),
    new Document({
        pageContent: 'Cats are independent pets that often enjoy their own space.',
        metadata: {source: 'mammal-pets-doc'}
    })
];
// 2.生成Embedding
const vector1 = await embeddingModel.embedQuery(document[0].pageContent);
const vector2 = await embeddingModel.embedQuery(document[1].pageContent);

assert(vector1.length === vector2.length);
test('Generate Embedding Vector', async () => {
    console.log(`Generated vectors of length ${vector1.length}\n`);
    console.log(vector1.slice(0, 10));
});

// 3.选择矢量存储库
const vectorStore = new MemoryVectorStore(embeddingModel);

// 4.加载并分割PDF文件
async function loadPdfPages(filePath: string): Promise<Document[]> {
    const parser = new PDFParse({
        data: new Uint8Array(readFileSync(filePath))
    });

    try {
        const {pages} = await parser.getText();
        return pages.map(page => new Document({
            pageContent: page.text,
            metadata: {source: filePath, page: page.num - 1},
        }));
    } finally {
        await parser.destroy();
    }
}

const filePath = `${process.cwd()}/src/data/nke-10k-2023.pdf`;
const docs = await loadPdfPages(filePath);

test('Load And Split PDF', async () => {
    console.log('Doc Length: ' + docs.length);
    console.log('Doc Content:');
    docs.forEach((doc) => {
        console.log(doc.pageContent);
    });
});

const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200
});

const allSplits = await textSplitter.splitDocuments(docs);

test('Log Split Length', async () => {
    console.log('Split Length: ' + allSplits.length);
    console.log('Split Content:');
    allSplits.forEach((split) => {
        console.log(split.pageContent);
    });
});

// 5.将数据块添加到向量库
// embeddingModel.batchSize = 20;
// await vectorStore.addDocuments(allSplits);

for (let i = 0; i < allSplits.length; i += 20) {
    await vectorStore.addDocuments(allSplits.slice(i, i + 20));
    await new Promise(resolve => setTimeout(resolve, 2000));
}

// 6.查询向量库
test('Search Vector Store By String', async () => {
    const result = await vectorStore.similaritySearch('When was Nike incorporated?');
    console.log(result[0]);
});


test('Search Vector Store By String With Score', async () => {
    const results = await vectorStore.similaritySearchWithScore(
        "What was Nike's revenue in 2023?"
    );

    console.log(results[0]);
});

test('Search By Vector', async () => {
    const embedding = await embeddingModel.embedQuery("How were Nike's margins impacted in 2023?");

    const results = await vectorStore.similaritySearchVectorWithScore(
        embedding, 1);

    console.log(results[0]);
});