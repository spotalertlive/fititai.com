import AWS from "aws-sdk";
import fs from "fs";

AWS.config.update({ region: process.env.AWS_REGION });

export const rekognition = new AWS.Rekognition();
export const s3 = new AWS.S3();
export const ses = new AWS.SES({ apiVersion: "2010-12-01" });

// Upload an image to S3
export async function uploadToS3(filePath, key) {
  const fileData = fs.readFileSync(filePath);
  const params = { Bucket: process.env.S3_BUCKET, Key: key, Body: fileData };
  return s3.upload(params).promise();
}

// Detect faces
export async function detectFaces(bucket, key) {
  const params = { Image: { S3Object: { Bucket: bucket, Name: key } } };
  const result = await rekognition.detectFaces(params).promise();
  return result.FaceDetails;
}

// Send notification email
export async function sendAlertEmail(to, subject, message) {
  const params = {
    Destination: { ToAddresses: [to] },
    Message: {
      Body: { Text: { Data: message } },
      Subject: { Data: subject }
    },
    Source: process.env.EMAIL_FROM
  };
  return ses.sendEmail(params).promise();
}
