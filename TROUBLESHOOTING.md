# AutoCut 平台 - 快速故障排查指南

## 🔧 常见问题与解决方案

### 问题 1：creditRates 表查询失败

**错误信息**：
```
Table 'fowkvf5lgmj9pemqiwhw5a.creditRates' doesn't exist
```

**原因分析**：
- CreditService 在启动时尝试初始化积分费率
- 但 creditRates 表可能未正确创建或数据为空

**快速修复**：

```bash
# 方案 1：重新执行迁移
cd /home/ubuntu/autocut
pnpm drizzle-kit migrate

# 方案 2：检查表是否存在
# 登录数据库查看
mysql -u root -p$DATABASE_URL

# 方案 3：手动插入默认费率
# 在数据库中执行
INSERT INTO creditRates (type, creditsPerMinute, description) VALUES
('analysis', 10, '视频分析'),
('editing', 15, '视频剪辑'),
('subtitle', 8, '字幕生成');
```

**长期解决方案**：
修改 `server/services/creditService.ts`，添加表存在性检查：

```typescript
async function initializeCreditRates() {
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[CreditService] Database not available");
      return;
    }

    // 尝试查询，如果表不存在会捕获错误
    try {
      const rates = await db.query.creditRates.findMany();
      if (rates.length === 0) {
        // 插入默认费率
        await db.insert(creditRates).values([
          { type: "analysis", creditsPerMinute: 10, description: "视频分析" },
          { type: "editing", creditsPerMinute: 15, description: "视频剪辑" },
          { type: "subtitle", creditsPerMinute: 8, description: "字幕生成" }
        ]);
        console.log("[CreditService] Default credit rates initialized");
      }
    } catch (tableError) {
      console.warn("[CreditService] creditRates table not ready yet:", tableError.message);
      // 表不存在时不抛出错误，等待迁移完成
    }
  } catch (error) {
    console.error("[CreditService] Initialization failed:", error);
  }
}
```

---

### 问题 2：邮箱验证码未收到

**现象**：
- 用户点击"发送验证码"后无反应
- 邮箱中未收到验证码

**原因分析**：
- 邮件服务为模拟实现（仅 console.log）
- 未集成真实邮件服务商

**临时解决方案**：
1. 检查浏览器控制台，查看验证码是否输出
2. 使用输出的验证码进行测试

**永久解决方案**：
集成真实邮件服务（参考 TESTING_AND_INTEGRATION.md 中的邮件集成部分）

---

### 问题 3：登录后跳转到仪表板但无法加载数据

**现象**：
- 登录成功，页面跳转到 /dashboard
- 但积分数据无法加载，显示"无法加载积分"

**原因分析**：
- 邮箱登录未建立真实的认证会话
- protectedProcedure 无法识别用户身份

**解决方案**：

修改 `server/services/authService.ts` 的 `loginWithCode` 函数：

```typescript
export async function loginWithCode(email: string, code: string) {
  // 1. 验证验证码
  const verified = await verifyCode(email, code);
  if (!verified) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "验证码无效或已过期"
    });
  }

  // 2. 获取或创建用户
  let user = await getUserByEmail(email);
  if (!user) {
    user = await createUser({
      email,
      openId: `email_${email}`, // 使用邮箱作为唯一标识
      loginMethod: "email"
    });
  }

  // 3. 更新最后登录时间
  await updateLastSignedIn(user.id);

  // 4. 返回用户信息
  return {
    success: true,
    message: "登录成功",
    userId: user.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      openId: user.openId
    }
  };
}
```

修改 `server/_core/context.ts` 以支持邮箱登录用户识别：

```typescript
export async function createContext(opts: CreateContextOptions) {
  // ... 现有代码
  
  // 检查邮箱登录用户
  const emailUser = req.cookies?.email_user;
  if (emailUser) {
    const user = await getUserByEmail(emailUser);
    if (user) {
      return { user, req, res };
    }
  }
  
  return { user: null, req, res };
}
```

---

### 问题 4：前端包体积过大

**现象**：
- 构建时显示警告：`Some chunks are larger than 500 kB`
- 首页加载缓慢

**原因分析**：
- React 及依赖库体积较大
- 未进行代码分割

**解决方案**：

在 `vite.config.ts` 中配置代码分割：

```typescript
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'ui': ['@radix-ui/react-dialog', '@radix-ui/react-tabs'],
          'trpc': ['@trpc/client', '@trpc/react-query'],
          'utils': ['date-fns', 'clsx', 'tailwind-merge']
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
});
```

---

### 问题 5：数据库连接失败

**错误信息**：
```
Error: connect ECONNREFUSED 127.0.0.1:3306
```

**原因分析**：
- MySQL 服务未启动
- 数据库 URL 配置错误

**解决方案**：

```bash
# 检查数据库连接字符串
echo $DATABASE_URL

# 验证数据库是否可访问
mysql -u root -p -h localhost -P 3306

# 检查 Drizzle 配置
cat drizzle.config.ts
```

---

### 问题 6：TypeScript 编译错误

**现象**：
- 运行 `pnpm check` 时出现类型错误
- 开发服务器无法启动

**解决方案**：

```bash
# 清理缓存
rm -rf node_modules/.vite

# 重新安装依赖
pnpm install

# 再次检查
pnpm check

# 如果仍有错误，查看详细信息
pnpm check 2>&1 | head -50
```

---

### 问题 7：开发服务器无响应

**现象**：
- 访问 http://localhost:3000 无反应
- 控制台显示连接超时

**解决方案**：

```bash
# 1. 检查服务器是否运行
ps aux | grep node

# 2. 查看端口占用情况
lsof -i :3000

# 3. 重启服务器
cd /home/ubuntu/autocut
pnpm dev

# 4. 如果仍无响应，清理缓存后重启
rm -rf .vite dist
pnpm dev
```

---

### 问题 8：路由 404 错误

**现象**：
- 点击导航链接后显示 404 页面
- 页面路由无法正确跳转

**原因分析**：
- 路由配置缺失
- 组件导入错误

**检查清单**：

```typescript
// 检查 App.tsx 中的路由配置
// 确保所有路由都已定义
<Route path="/dashboard" component={Dashboard} />
<Route path="/profile" component={Profile} />
<Route path="/login" component={Login} />
<Route path="/register" component={Register} />

// 检查组件是否正确导入
import Dashboard from "./pages/Dashboard/Index";
import Profile from "./pages/Dashboard/Profile";
```

---

### 问题 9：积分查询返回 null

**现象**：
- 个人中心显示"无法加载积分"
- API 返回 `{ success: false }`

**原因分析**：
- 用户积分记录未创建
- 数据库查询失败

**解决方案**：

```typescript
// 在 creditService.ts 中添加调试日志
export async function getBalance(userId: number) {
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[CreditService] Database not available");
      return null;
    }

    console.log(`[CreditService] Fetching balance for user ${userId}`);
    
    const balance = await db.query.userCredits.findFirst({
      where: eq(userCredits.userId, userId)
    });

    console.log(`[CreditService] Balance found:`, balance);
    
    if (!balance) {
      // 为新用户创建初始积分记录
      await db.insert(userCredits).values({
        userId,
        balance: 1000, // 新用户赠送 1000 积分
        totalEarned: 1000,
        totalUsed: 0
      });
      
      return { balance: 1000, totalEarned: 1000, totalUsed: 0 };
    }

    return balance;
  } catch (error) {
    console.error("[CreditService] Get balance failed:", error);
    return null;
  }
}
```

---

### 问题 10：CORS 跨域错误

**错误信息**：
```
Access to XMLHttpRequest from origin 'http://localhost:3000' has been blocked by CORS policy
```

**解决方案**：

在 `server/_core/index.ts` 中配置 CORS：

```typescript
import cors from "cors";

app.use(cors({
  origin: process.env.NODE_ENV === "production" 
    ? process.env.FRONTEND_URL 
    : "http://localhost:3000",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
```

---

## 📊 诊断命令

### 检查项目健康状态

```bash
# 1. TypeScript 检查
pnpm check

# 2. 依赖检查
pnpm list --depth=0

# 3. 数据库连接测试
mysql -u root -p$DATABASE_URL -e "SELECT 1;"

# 4. 构建测试
pnpm build

# 5. 测试运行
pnpm test

# 6. 开发服务器启动
pnpm dev
```

### 查看日志

```bash
# 开发服务器日志
tail -f .manus-logs/devserver.log

# 浏览器控制台日志
tail -f .manus-logs/browserConsole.log

# 网络请求日志
tail -f .manus-logs/networkRequests.log
```

---

## 🆘 获取帮助

如果问题未在本文档中解决，请：

1. **查看项目文档**：
   - `README_VIDEOMIND.md` - 项目概述
   - `TESTING_AND_INTEGRATION.md` - 测试与集成指南

2. **检查日志文件**：
   - `.manus-logs/devserver.log` - 服务器日志
   - `.manus-logs/browserConsole.log` - 浏览器日志

3. **运行诊断**：
   ```bash
   pnpm check
   pnpm build
   pnpm test
   ```

4. **重置项目**：
   ```bash
   # 清理所有缓存
   rm -rf node_modules dist .vite
   
   # 重新安装
   pnpm install
   
   # 重新迁移数据库
   pnpm drizzle-kit migrate
   
   # 重启开发服务器
   pnpm dev
   ```

---

**最后更新**：2026-05-04
**文档版本**：1.0
