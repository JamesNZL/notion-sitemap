const { Client, isNotionClientError } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_KEY });

async function makeRequest(method, parameters) {
	try {
		return await method(parameters);
	}

	catch (error) {
		const type = (isNotionClientError(error)) ? 'NOTION_ERROR' : 'UNKNOWN_ERROR';

		console.error({ type, error });
	}
}

async function makePaginatedRequest(method, parameters) {
	let response = await makeRequest(method, parameters);

	if (response) {
		const _results = response.results;

		while (response.has_more) {
			parameters.start_cursor = response.next_cursor;

			response = await makeRequest(method, parameters);

			_results.push(...response.results);
		}

		response.results = _results;
	}

	return response;
}

async function queryDatabase(databaseId, filter) {
	return await makePaginatedRequest(
		notion.databases.query,
		{ database_id: databaseId, filter },
	);
}

async function retrieveDatabase(databaseId) {
	return await makeRequest(
		notion.databases.retrieve,
		{ database_id: databaseId },
	);
}

async function retrievePage(pageId) {
	return await makeRequest(
		notion.pages.retrieve,
		{ page_id: pageId },
	);
}

async function createPage(parameters) {
	return await makeRequest(
		notion.pages.create,
		parameters,
	);
}

async function retrieveBlock(blockId) {
	return await makeRequest(
		notion.blocks.retrieve,
		{ block_id: blockId },
	);
}

async function retrieveBlockChildren(parameters) {
	return await makePaginatedRequest(
		notion.blocks.children.list,
		parameters,
	);
}

module.exports = {
	queryDatabase,
	retrieveDatabase,
	retrievePage,
	createPage,
	retrieveBlock,
	retrieveBlockChildren,
};