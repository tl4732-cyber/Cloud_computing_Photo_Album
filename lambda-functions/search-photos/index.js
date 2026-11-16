const { LexRuntimeV2Client, RecognizeTextCommand } = require("@aws-sdk/client-lex-runtime-v2");
const { Client } = require("@opensearch-project/opensearch");

const lex = new LexRuntimeV2Client({});

function openSearch() {
  return new Client({
    node: process.env.OS_ENDPOINT,
    auth: {
      username: process.env.OS_USER,
      password: process.env.OS_PASSWORD,
    },
  });
}

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,x-amz-meta-customLabels",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  try {
    const query = (event.queryStringParameters && event.queryStringParameters.q) || "";
    console.log("query", query);

    if (!query.trim()) {
      return { statusCode: 200, headers, body: JSON.stringify({ results: [] }) };
    }

    const lexResp = await lex.send(new RecognizeTextCommand({
      botId: process.env.LEX_BOT_ID,
      botAliasId: process.env.LEX_BOT_ALIAS_ID,
      localeId: process.env.LEX_LOCALE || "en_US",
      sessionId: `search-${Date.now()}`,
      text: query,
    }));

    console.log("lex", JSON.stringify(lexResp.sessionState));

    const slots = lexResp.sessionState?.intent?.slots || {};
    const slotKeywords = ["keyword1", "keyword2"]
      .map((name) => slots[name]?.value?.interpretedValue || slots[name]?.value?.originalValue)
      .filter(Boolean)
      .map((word) => word.toLowerCase());

    const stopWords = new Set(["show", "me", "photos", "photo", "with", "of", "find", "a", "an", "the", "and", "in", "them", "please"]);
    const textKeywords = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word && !stopWords.has(word));
    const keywords = textKeywords.length > slotKeywords.length ? textKeywords : slotKeywords;

    if (keywords.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ results: [] }) };
    }

    const response = await openSearch().search({
      index: "photos",
      body: {
        size: 50,
        query: {
          bool: {
            must: keywords.map((keyword) => ({
              bool: {
                should: [
                  { match: { labels: keyword } },
                  { term: { "labels.raw": keyword } },
                ],
                minimum_should_match: 1,
              },
            })),
          },
        },
      },
    });

    const results = (response.body.hits.hits || []).map((hit) => ({
      url: `https://${hit._source.bucket}.s3.us-east-1.amazonaws.com/${encodeURIComponent(hit._source.objectKey)}`,
      labels: hit._source.labels,
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ results }) };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ code: 500, message: error.message }),
    };
  }
};
