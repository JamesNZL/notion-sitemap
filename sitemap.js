const notion = require('./notion');

// Whether to log when unsupported blocks are encountered
const logUnsupported = false;
// The maximum number of database pages to continue recursing through
const maximumDatabasePagesToRetrieve = 5;
// Whether to ignore all database pages if more than the above count are encountered
const ignoreAllPagesIfMoreThanMaximum = true;
// The maximum number of levels to recurse through, or null for no maximum
const maximumNestLevel = null;

function resolvePageTitle(page) {
	return page?.child_page?.title ?? page?.child_database?.title ?? page.id;
}

async function findChildPages(pageId, type) {
	let pageBlock;

	if (type === 'child_page') pageBlock = await notion.retrieveBlock(pageId);
	else if (type === 'child_database') pageBlock = await notion.queryDatabase(pageId);

	if (!pageBlock) return;

	const childPages = [];

	if (pageBlock?.has_children ?? pageBlock?.results?.length) {
		if (type === 'child_page') {
			const blockChildren = await notion.retrieveBlockChildren({ block_id: pageId, page_size: 100 });

			const unsupportedBlocks = blockChildren.results.filter(childBlock => childBlock.type === 'unsupported');

			// Log if an unsupported block has been found
			if (unsupportedBlocks.length && logUnsupported) {
				console.log(`Unsupported block(s) in '${pageBlock.child_page.title}'`);
				console.log(unsupportedBlocks);
			}

			// Filter for <BlockObject>[] of child pages, databases and unsupported blocks
			childPages.push(...blockChildren.results
				.filter(childBlock => ['child_page', 'child_database', 'unsupported'].includes(childBlock.type)),
			);
		}

		else if (type === 'child_database') {
			const databasePages = pageBlock.results
				.map(childPage => {
					childPage.type = 'child_page';
					return childPage;
				});

			if ((ignoreAllPagesIfMoreThanMaximum && databasePages.length <= maximumDatabasePagesToRetrieve) || !ignoreAllPagesIfMoreThanMaximum) {
				childPages.push(...databasePages.slice(0, maximumDatabasePagesToRetrieve - 1));
			}
		}
	}

	return {
		parentTitle: resolvePageTitle(pageBlock),
		parentId: pageBlock.id,
		childPages,
	};
}

function recordChildPages(pageChildren) {
	return pageChildren.childPages
		.map(page => ({
			type: page.type,
			pageId: page.id,
			pageOrder: page.pageOrder,
		}));
}

function resolvePagePlainText(page) {
	try {
		const _pageTitle = page?.properties?.title?.title || Object.values(page?.properties || {}).find(({ id }) => id === 'title')?.title || [];
		const databaseTitle = page?.title || [];

		const pageTitle = (_pageTitle?.length) ? _pageTitle : [];

		// Last line of defence against {}
		const nameArray = [...pageTitle, ...databaseTitle];

		return (nameArray.length)
			? nameArray.map(({ plain_text }) => plain_text).join('')
			: null;
	}

	catch (error) {
		console.error({ error, page });
	}
}

function formatPageURL(page) {
	const pageIcon = page?.icon?.emoji;
	const pageTitle = resolvePagePlainText(page) ?? page.id;

	return (page.url)
		? `[${(pageIcon) ? `${pageIcon} ` : ''}${pageTitle}](${page.url})`
		: pageTitle;
}

const tabs = count => '\t'.repeat(count);

function generateOutput(pageTree) {
	return pageTree.reduce((output, page) => {
		const nestLevel = page.pageOrder.length - 1;

		return output + `${tabs(nestLevel)}- ${formatPageURL(page)}\n`;
	}, '');
}

function sortPageOrder(pageOne, pageTwo) {
	const shallowestNest = Math.min(pageOne.pageOrder.length, pageTwo.pageOrder.length);

	for (let i = 0; i < shallowestNest; i++) {
		if (pageOne.pageOrder[i] === pageTwo.pageOrder[i]) {
			if (i === shallowestNest - 1) return pageOne.pageOrder.length - pageTwo.pageOrder.length;
			else continue;
		}

		return pageOne.pageOrder[i] - pageTwo.pageOrder[i];
	}
}

(async () => {
	const foundPages = new Set();

	const scriptId = process.env.SCRIPT_ID;
	if (!scriptId) return console.error('Invalid scriptId!');

	let pages = [{ type: 'child_page', pageId: scriptId, pageOrder: [1] }];

	console.log('\n\n\nStarting execution...');

	let oldNestLevel = pages[0].pageOrder.length;

	while (pages.length) {
		const { type, pageId, pageOrder } = pages.shift();

		if (maximumNestLevel && pageOrder.length > maximumNestLevel) break;

		if (pageOrder.length > oldNestLevel) console.log(`Now at nest level ${pageOrder.length} (${pages.length} pages)...`);

		if (type === 'child_page' || type === 'child_database') {
			const pageChildren = await findChildPages(pageId, type);

			// Record found child pages in Set
			pageChildren.childPages.forEach((child, index) => {
				child.pageOrder = [...pageOrder, index];

				// Store full child page object as JSON in the foundPages Set
				foundPages.add(JSON.stringify(child));
			});

			// Add found child pages to pages array to be searched
			pages = [...pages, ...recordChildPages(pageChildren)];
		}

		oldNestLevel = pageOrder.length;
	}

	console.log('Generating page tree...');

	const pageTree = await Promise.all([...foundPages.values()]
		.map(async page => {
			page = JSON.parse(page);

			let retrievedObject = page;

			if (page.type === 'child_page') retrievedObject = await notion.retrievePage(page.id);
			else if (page.type === 'child_database') retrievedObject = await notion.retrieveDatabase(page.id);

			// Properties from while loop to transfer over
			retrievedObject.pageOrder = page.pageOrder;

			return retrievedObject;
		}),
	);

	const scriptPage = await notion.retrievePage(scriptId);
	scriptPage.pageOrder = [1];

	console.log('Generating sitemap...');

	const output = generateOutput([scriptPage, ...pageTree.sort(sortPageOrder)]);

	console.log('Generated sitemap!\n\n\n');
	console.log(output);
})();