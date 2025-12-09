import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from '../utils/s3client';
import { Response, getResponse } from '../models/response';
import os from 'os';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

const s3Client = s3;

export class ManimScriptCompiler {
  private readonly bucketName: string;
  private readonly tempDir: string;
  private initPromise: Promise<void>;

  constructor() {
    this.bucketName = process.env.S3_BUCKET_NAME || 'manim-videos';
    this.tempDir = path.join(os.tmpdir(), 'temp');
    this.initPromise = this.ensureTempDir();
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      console.error(`Temp directory ensured at: ${this.tempDir}`);
    } catch (error) {
      console.error(`Failed to create temp directory: ${error}`);
      throw error;
    }
  }

  private async cleanupFiles(scriptPath: string): Promise<void> {
    try {
      const mediaDir = path.join(this.tempDir, 'media');
      const pyCacheDir = path.join(this.tempDir, '__pycache__');

      await fs.unlink(scriptPath);
      console.error(`Cleaned up script file: ${scriptPath}`);

      await fs.rm(mediaDir, { recursive: true, force: true });
      console.error(`Cleaned up media directory: ${mediaDir}`);

      await fs.rm(pyCacheDir, { recursive: true, force: true });
      console.error(`Cleaned up __pycache__ directory: ${pyCacheDir}`);
    } catch (error) {
      console.warn('Failed to cleanup files:', error);
    }
  }

  private async uploadToS3(filePath: string, key: string): Promise<string> {
    try {
      const accessible = await fs.access(filePath);

      console.error("access: " + accessible);

      const fileContent = await fs.readFile(filePath);

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: fileContent,
        ContentType: 'video/mp4',
      });

      await s3Client.send(command);

      // Generate presigned URL that expires in 1 hour
      const getObjectCommand = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const presignedUrl = await getSignedUrl(s3Client, getObjectCommand, {
        expiresIn: 604800 // URL expires in 1 hour
      });

      return presignedUrl;
    } catch (error) {
      throw new Error(`S3 upload failed: ${error}`);
    }
  }

  private validateManimScript(script: string): void {
    // Basic validation to ensure it's a proper Manim script
    if (!script.includes('from manim import')) {
      throw new Error('Invalid Manim script: Must import from manim');
    }

    if (!script.includes('class ') || !script.includes('Scene')) {
      throw new Error('Invalid Manim script: Must contain a Scene class');
    }

    // Security check - prevent dangerous operations
    const dangerousPatterns = [
      'import os',
      'import subprocess',
      'import sys',
      '__import__',
      'eval(',
      'exec(',
      'open(',
      'file(',
    ];

    for (const pattern of dangerousPatterns) {
      if (script.includes(pattern)) {
        throw new Error(`Security violation: Script contains forbidden pattern: ${pattern}`);
      }
    }
  }


  async compileScript(script: string): Promise<Response<string>> {
    const startTime = Date.now();
    const sessionId = randomUUID();
    // const sessionId = 'test';
    console.error('sessionid: ' + sessionId);
    const scriptPath = path.join(this.tempDir, `${sessionId}.py`);
    const mediaDir = path.join(this.tempDir, 'media');

    try {
      // Ensure dirs exist
      console.error("inside compile script.");
      await fs.mkdir(this.tempDir, { recursive: true });
      await fs.mkdir(mediaDir, { recursive: true });

      // Validate script
      this.validateManimScript(script);

      // Save script to temp file
      await fs.writeFile(scriptPath, script);

      // Extract scene name
      const sceneMatch = script.match(/class\s+(\w+)\s*\([^)]*Scene[^)]*\)/);
      const sceneName = sceneMatch ? sceneMatch[1] : 'DefaultScene';
      console.error("sceneName:", sceneName);

      // Manim command
      // const manimPath = process.env.MANIM_PATH ||'/Users/mihirshah/Documents/ai_animation_generator/mcp_animation_generator/venv/bin/manim';
      const manimPath = process.env.MANIM_PATH ||'';
      const manimCommand = `${manimPath} render -qh ${scriptPath} ${sceneName} --format=mp4 --media_dir "${path.join(this.tempDir, 'media')}"`;


      console.error(`Executing: ${manimCommand}`);

      try {
        // const { stdout, stderr } = await execAsync(manimCommand, {
        //   timeout: 300000, // 5 minutes
        //   cwd: this.tempDir,
        //   env: {
        //     ...process.env,
        //     PATH: `${path.join('/Users/mihirshah/Documents/ai_animation_generator/mcp_animation_generator/venv/bin')}:${process.env.PATH}:/usr/local/texlive/2023/bin/universal-darwin:/Library/TeX/texbin`,
        //     VIRTUAL_ENV: '/Users/mihirshah/Documents/mcp_animation_generator/code_compiler/venv',
        //     PYTHONPATH: `${path.join('/Users/mihirshah/Documents/mcp_animation_generator/code_compiler/venv/lib/python3.11/site-packages')}:${process.env.PYTHONPATH || ''}`
        //   }
        // });

        const { stdout, stderr } = await execAsync(manimCommand, {
          timeout: 300000, // 5 minutes
          cwd: this.tempDir,
          env: {
            ...process.env,
            PATH: `${path.join(process.env.VENV_BIN_PATH || '')}:${process.env.PATH}:/usr/local/texlive/2023/bin/universal-darwin:/Library/TeX/texbin`,
            VIRTUAL_ENV: process.env.VIRTUAL_ENV || '',
            // PYTHONPATH: `${path.join('/Users/mihirshah/Documents/mcp_animation_generator/code_compiler/venv/lib/python3.11/site-packages')}:${process.env.PYTHONPATH || ''}`
            PYTHONPATH: `${path.join(process.env.VIRTUAL_ENV || '' , '/lib/python3.11/site-packages')}:${process.env.PYTHONPATH || ''}`
          }
        });

        console.error("stderr: " + stderr);

        if (stderr.toLowerCase().includes('exception') || stderr.toLowerCase().includes('traceback') || stderr.toLowerCase().includes('filenotfounderror') || stderr.toLowerCase().includes('valueerror')) {
          throw new Error(`Manim compilation error: ${stderr}`);
        }

        console.error('Manim stdout:', stdout);
      } catch (execError: any) {
        // Clean up files before throwing error
        await this.cleanupFiles(scriptPath);

        if (execError.code === 'ETIMEDOUT') {
          return getResponse('failed', 'Compilation exceeded 5 minute timeout', 'ETIMEDOUT');
        }

        const errorMessage = execError.stderr || execError.message;
        console.error(errorMessage);
        return getResponse('failed', `Compilation failed: ${errorMessage}`, '');
      }

      // Search for MP4 file
      // const videoPath = await this.findVideoFile(mediaDir);
      const videoPath = path.resolve(mediaDir, 'videos', `${sessionId}`, '1080p60', `${sceneName}.mp4`)

      console.error(videoPath);
      if (!videoPath) {
        throw new Error(`Manim did not produce a video file in ${mediaDir}`);
      }

      // Upload to S3
      const s3Key = `videos/${sessionId}/${path.basename(videoPath)}`;
      const videoUrl = await this.uploadToS3(videoPath, s3Key);


      await this.cleanupFiles(scriptPath);

      const executionTime = Date.now() - startTime;
      console.error(`Execution time: ${executionTime}ms`);

      return getResponse('success', 'File uploaded', videoUrl);

    } catch (error) {
      console.error("Compilation failed:", error);
      return getResponse('failed', error instanceof Error ? error.message : 'Unknown error', '');
    }
  }

}
