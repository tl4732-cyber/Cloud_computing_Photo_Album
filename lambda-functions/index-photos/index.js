const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { RekognitionClient, DetectLabelsCommand } = require("@aws-sdk/client-rekognition");
const { Client } = require("@opensearch-project/opensearch");

const s3 = new S3Client({});
const rekognition = new RekognitionClient({});

function openSearch() {
  return new Client({
    node: process.env.OS_ENDPOINT,
    auth: {
      username: process.env.OS_USER,
      password: process.env.OS_PASSWORD,
    },
  });
}

exports.handler = async (event) => {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const objectKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

  const detected = await rekognition.send(new DetectLabelsCommand({
    Image: { S3Object: { Bucket: bucket, Name: objectKey } },
    MaxLabels: 50,
    MinConfidence: 70,
  }));

  const labels = new Set();
  for (const label of detected.Labels || []) {
    labels.add(label.Name.toLowerCase());
  }

  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  const custom = head.Metadata?.customlabels || "";
  custom.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    .forEach((label) => labels.add(label));

  const doc = {
    objectKey,
    bucket,
    createdTimestamp: (head.LastModified || new Date()).toISOString(),
    labels: [...labels],
  };

  console.log("indexing", JSON.stringify(doc));

  await openSearch().index({
    index: "photos",
    id: objectKey,
    body: doc,
    refresh: true,
  });

  return doc;
};
