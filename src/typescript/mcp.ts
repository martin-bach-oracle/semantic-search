import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = "http://localhost:8080/ords/demouser/api/search/";

export interface SearchResult {
	link: string;
	title: string;
}

async function fetchSearchResults(
	searchTerm: string,
): Promise<SearchResult[] | null> {
	if (typeof searchTerm !== "string" || !searchTerm) {
		throw new Error("searchTerm must be a non-empty string");
	}

	try {
		const response = await fetch(`${API_URL}${encodeURIComponent(searchTerm)}`);
		if (!response.ok) {
			throw new Error(`API error: ${response.status}`);
		}
		return (await response.json()) as SearchResult[];
	} catch (error) {
		console.error("Error making API request:", error);
		return null;
	}
}

function formatSearchResult(result: SearchResult): string {
	return [
		`Title: ${result.title || "unknown"}`,
		`Link: ${result.link} || "unknown" `,
		"---",
	].join("\n");
}

//
// Create server instance
//
const server = new McpServer({
	name: "semantic-search",
	version: "0.0.1",
	capabilities: {
		resources: {},
		tools: {},
	},
});

//
// register tool to fetch search results
//
server.tool(
	"fetchSearchResults",
	"fetch search results from the blog using Oracle 23ai Vector Search",
	{
		// must be done this way or else no input is accepted in the inspector
		searchTerm: z
			.string()
			.min(3)
			.describe("The term to search for in all blog articles"),
	},
	async ({ searchTerm }) => {
		const data = await fetchSearchResults(searchTerm);

		// fetchSearchResults can return null in case of an error
		if (!data) {
			return {
				content: [
					{
						type: "text",
						text: "Failed to retrieve search results.",
					},
				],
			};
		}

		// let's see how many hits we have
		if (data.length === 0) {
			return {
				content: [
					{
						type: "text",
						text: `No hits for ${searchTerm}`,
					},
				],
			};
		}

		const formattedResults = data.map(formatSearchResult);
		const responseText = `search results to ${searchTerm}\n'n${formattedResults.join("\n")}`;

		return {
			content: [
				{
					type: "text",
					text: responseText,
				},
			],
		};
	},
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Semantic Search MCP Server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in main():", error);
	process.exit(1);
});