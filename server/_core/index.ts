import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import multer from "multer";
import { sdk } from "./sdk";
import { validateVideoFile, saveVideo } from "../services/videoService";
import { videos } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import "../services/analysisService";
import "../services/editingService";
import "../services/subtitleService";
import "../services/aiEditService";
import "../services/ttsService";
import path from "node:path";
import fs from "node:fs";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // 确保上传目录存在
  const uploadDir = path.resolve("uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  });

  // 视频上传接口
  app.post("/api/videos/upload", upload.array("files", 10), async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        return res.status(401).json({ success: false, message: "请先登录" });
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, message: "没有选择文件" });
      }

      const projectId = req.body.projectId ? parseInt(req.body.projectId) : undefined;

      const results = [];
      for (const file of files) {
        const validation = validateVideoFile(
          file.originalname,
          file.mimetype,
          file.size
        );

        if (!validation.valid) {
          fs.unlinkSync(file.path);
          results.push({
            fileName: file.originalname,
            success: false,
            error: validation.error,
          });
          continue;
        }

        const video = await saveVideo(
          user.id,
          file.originalname,
          file.mimetype,
          file.size,
          file.path,
          projectId
        );

        fs.unlinkSync(file.path);

        results.push({
          fileName: file.originalname,
          success: true,
          videoId: video.id,
          fileSize: file.size,
        });
      }

      res.json({ success: true, data: results });
    } catch (error) {
      console.error("[Upload] Error:", error);
      res.status(500).json({ success: false, message: "上传失败" });
    }
  });

  // 确保缩略图目录存在
  const thumbDir = path.resolve("uploads/thumbnails");
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }

  // 视频封面缩略图接口
  app.get("/api/videos/thumbnail/:id", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        return res.status(401).json({ success: false, message: "请先登录" });
      }

      const videoId = parseInt(req.params.id);
      if (isNaN(videoId)) {
        return res.status(400).json({ success: false, message: "无效的视频 ID" });
      }

      const thumbPath = path.join(thumbDir, `${videoId}.jpg`);
      if (fs.existsSync(thumbPath)) {
        return res.sendFile(thumbPath);
      }

      // 查找视频
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) {
        return res.status(500).json({ success: false, message: "数据库不可用" });
      }

      const result = await db
        .select({ filePath: videos.filePath })
        .from(videos)
        .where(eq(videos.id, videoId))
        .limit(1);

      if (result.length === 0) {
        return res.status(404).json({ success: false, message: "视频不存在" });
      }

      const videoPath = result[0].filePath;
      if (!fs.existsSync(videoPath)) {
        return res.status(404).json({ success: false, message: "视频文件不存在" });
      }

      // 提取第一帧作为封面
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(exec)(`ffmpeg -i "${videoPath}" -vframes 1 -q:v 3 "${thumbPath}" -y`);

      if (fs.existsSync(thumbPath)) {
        res.sendFile(thumbPath);
      } else {
        res.status(500).json({ success: false, message: "封面生成失败" });
      }
    } catch (error) {
      console.error("[Thumbnail] Error:", error);
      res.status(500).json({ success: false, message: "封面获取失败" });
    }
  });

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
