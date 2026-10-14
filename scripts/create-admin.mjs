import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const email = (process.argv[2] || "flavialimahot5@gmail.com").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("E-mail inválido.");
mkdirSync(".local", { recursive: true });
const loginFile = resolve(".local/admin-login.txt");
const envFile = resolve(".local/admin-vercel.env");
if (existsSync(loginFile) || existsSync(envFile)) throw new Error("Os arquivos de acesso já existem. Guarde-os antes de gerar outra senha.");
const password = randomBytes(24).toString("base64url");
const salt = randomBytes(16);
const hash = "scrypt$" + salt.toString("hex") + "$" + scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
writeFileSync(loginFile, `Acesso privado ao Goti Pay Portugal\nE-mail: ${email}\nSenha: ${password}\n\nConfigure as variáveis de admin-vercel.env na Vercel e faça Redeploy.\nTambém é necessário configurar o banco Turso e aplicar as migrações.\nGuarde este arquivo em local seguro. Não envie para o GitHub.\n`, {flag:"wx", mode:0o600});
// Single quotes preserve literal dollar signs when importing dotenv values.
writeFileSync(envFile, `ALLOWED_EMAILS=${email}\nADMIN_USERS='${JSON.stringify({[email]:hash})}'\nAUTH_SECRET=${randomBytes(32).toString("base64url")}\nAPP_ORIGIN=https://SEU-NOVO-PROJETO-PORTUGAL.vercel.app\nAUTH_URL=https://SEU-NOVO-PROJETO-PORTUGAL.vercel.app\nPUBLIC_API_ENABLED=false\n`, {flag:"wx", mode:0o600});
console.log(`Acesso salvo em ${loginFile}\nVariáveis para importar na Vercel: ${envFile}\nNenhuma senha foi exibida no terminal.`);
