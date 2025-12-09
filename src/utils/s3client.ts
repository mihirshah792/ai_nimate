import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config();

class AWSS3Client {
    private static instance: S3Client;

    private constructor() {}   

    public static getInstance(): S3Client {
        if (!AWSS3Client.instance) {
            AWSS3Client.instance = new S3Client({
                region: process.env.AWS_REGION || 'us-east-1',
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });
        }
        return AWSS3Client.instance;
    }
}

export const s3 = AWSS3Client.getInstance();