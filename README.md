# IntelliStock - Sistema de Gerenciamento de Estoque

Atualizacao de validacao de deploy em 18/05/2026.

API e interface web para controle de materiais e insumos, construida com **Node.js**, **Express** e **MySQL**.

---

## Sobre o projeto

Centralize entradas, saidas e acompanhamento dos seus materiais em um so lugar.

O sistema e composto por:
- **Backend (API REST)** com Node.js + Express
- **Banco de dados MySQL** para persistencia
- **Interface web** (HTML + CSS + JS puro) para operacao diaria
- **Autenticacao com 2FA** por e-mail (Gmail)
- **Recuperacao de senha** por link enviado ao e-mail

---

## Pre-requisitos

- [Node.js v14+](https://nodejs.org/) (baixe a versao LTS)
- [MySQL Community Server](https://dev.mysql.com/downloads/mysql/) (versao 5.7 ou 8.x) + [MySQL Workbench](https://dev.mysql.com/downloads/workbench/)
- Conta Gmail com **App Password** habilitada (para envio de e-mail)

### Verificando se o MySQL esta rodando (Windows)

Após instalar, abra o **Gerenciador de Tarefas → Servicos** e confirme que o servico `MySQL80` (ou `MySQL57`) esta com status **Em execucao**.
Ou pelo PowerShell:

```powershell
Get-Service -Name MySQL*
```

Se aparecer `Stopped`, inicie com:

```powershell
Start-Service -Name MySQL80
```

---

## Instalacao passo a passo

### 1. Clone o repositorio e instale as dependencias

```bash
git clone https://github.com/Ryangamer1902/IntelliStock.git
cd IntelliStock
npm install
```

### 2. Crie o banco de dados no MySQL

Abra o **MySQL Workbench** (ou terminal) e execute:

```sql
CREATE DATABASE IF NOT EXISTS estoque_db;
USE estoque_db;
```

Depois execute o arquivo `src/database/schema.sql` completo (botao **Run All** no Workbench, ou pela linha de comando):

```powershell
mysql -u root -p estoque_db < src/database/schema.sql
```

> A tabela `tokens_reset_senha` (recuperacao de senha) e criada automaticamente ao iniciar o servidor - nao precisa de nenhum passo extra.

### 3. Configure o arquivo `.env`

Execute o assistente interativo.

> **Importante:** use o **terminal do VS Code** (menu Terminal → Novo Terminal) ou o **CMD** do Windows para este passo. O PowerShell pode travar na entrada de dados interativa.

```bash
npm run setup:db
```

Responda conforme abaixo:

| Campo | Valor tipico |
|-------|-------------|
| Host do banco | `gateway01.us-east-1.prod.aws.tidbcloud.com` |
| Usuario MySQL | `2XDYENLZnueZPWm.root` |
| Senha MySQL | sua senha |
| Nome do banco | `estoque_db` |
| Porta do banco | `4000` |
| Porta da aplicacao | `3001` |
| Ambiente | `development` |
| Enviar 2FA por e-mail? | `true` |
| Gmail que envia os e-mails | seu endereco Gmail |
| App Password do Gmail | veja secao abaixo |

O arquivo `.env` sera criado automaticamente.

### 4. Inicie o servidor

```powershell
npm run dev
```

Resultado esperado:

```
Conexao com banco de dados estabelecida com sucesso
Servidor rodando em http://localhost:3001
Ambiente: development
```

Acesse: **http://localhost:3001**

---

## Credenciais de demonstracao

Na **primeira inicializacao** com banco vazio, o sistema cria automaticamente:

| Campo | Valor |
|-------|-------|
| E-mail | `admin@intellistock.com` |
| Senha | `Admin123` |

O codigo de verificacao 2FA chega no e-mail cadastrado (ou aparece como `codigo_demo` na resposta da API em modo `development` sem SMTP configurado).

---

## Configurando o Gmail (App Password)

> Necessario para o sistema enviar e-mails de verificacao 2FA e recuperacao de senha.

1. Acesse sua conta Google em [myaccount.google.com](https://myaccount.google.com)
2. Va em **Seguranca > Verificacao em duas etapas** e certifique-se de que esta ativada
3. Ainda em **Seguranca**, procure por **Senhas de app** (App Passwords)
4. Crie uma nova senha de app, escolha "Outro" e de o nome `IntelliStock`
5. Copie a senha gerada (16 caracteres, ex: `abcd efgh ijkl mnop`)
6. Cole **sem espacos** no campo `MAIL_PASS` do seu `.env`:

```env
MAIL_ENABLED=true
MAIL_USER=seuemail@gmail.com
MAIL_PASS=abcdefghijklmnop
MAIL_FROM="IntelliStock <seuemail@gmail.com>"
```

Os campos `MAIL_HOST`, `MAIL_PORT` e `MAIL_SECURE` sao preenchidos automaticamente para Gmail.

---

## Fluxo de autenticacao

```
Login -> Codigo 2FA por e-mail -> Acesso ao sistema
```

**Esqueci minha senha:**
```
Clicar "Esqueci minha senha" -> Informar e-mail -> Receber link -> Criar nova senha
```

O link de recuperacao expira em **30 minutos** e so pode ser usado **uma vez**.

---

## Scripts disponiveis

```bash
npm start          # Producao
npm run dev        # Desenvolvimento (nodemon, reinicia ao salvar)
npm run setup:db   # Assistente para criar/recriar o .env
npm run start:tudo # setup:db + dev em sequencia
npm run start:all  # npm install + start:tudo
```

---

## Modo mock (sem banco de dados)

Para desenvolver o frontend sem precisar de banco ou SMTP:

```js
// No console do navegador (DevTools)
localStorage.setItem('auth_mode', 'mock')  // desativa o backend
localStorage.setItem('auth_mode', 'api')   // volta ao modo real
```

---

## Problemas comuns

| Erro | Solucao |
|------|---------|
| `npm: arquivo nao pode ser carregado` (ExecutionPolicy) | Use `npm.cmd run dev` ou execute `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` |
| `Access denied for user 'root'@'localhost'` | Verifique a senha no `.env` |
| `Error Code 1046: No database selected` | Execute `USE estoque_db;` antes do schema |
| `MySQL port 3306 ja em uso` | Altere `DB_PORT` no `.env` (ex: `3307`) |
| E-mail nao chega | Confirme `MAIL_PASS` sem espacos e que a verificacao em 2 etapas do Google esta ativa |
| Link de reset "invalido ou expirado" | O link tem validade de 30 min, solicite um novo |

---

## Endpoints da API

### Autenticacao (`/api/auth`)

| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/api/auth/cadastro` | Criar nova conta |
| POST | `/api/auth/login` | Login (retorna token 2FA) |
| POST | `/api/auth/verificar` | Verificar codigo 2FA |
| POST | `/api/auth/solicitar-reset` | Solicitar redefinicao de senha |
| POST | `/api/auth/redefinir-senha` | Confirmar nova senha com token |

### Materiais (`/api/materiais`)

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/materiais` | Listar todos |
| GET | `/api/materiais/:id` | Buscar por ID |
| POST | `/api/materiais` | Criar material |
| PUT | `/api/materiais/:id` | Atualizar material |
| PUT | `/api/materiais/:id/quantidade` | Ajustar quantidade |
| DELETE | `/api/materiais/:id` | Remover material |
| GET | `/api/materiais/estoque/baixo` | Listar estoque baixo |
| GET | `/api/materiais/historico` | Historico de movimentacoes |

---

## Estrutura do projeto

```
IntelliStock/
|-- public/                  (Frontend HTML + CSS + JS)
|   |-- login.html
|   |-- verificacao.html
|   |-- redefinir-senha.html
|   |-- dashboard.html
|   `-- ...
|-- src/
|   |-- controllers/         (Logica de negocio)
|   |-- routes/              (Rotas da API)
|   |-- services/
|   |   `-- emailService.js  (SMTP Gmail)
|   |-- utils/
|   |   `-- seedAdmin.js     (Cria admin padrao)
|   `-- database/
|       `-- schema.sql       (Estrutura do banco)
|-- server.js
|-- setup-db.js
|-- .env.example
`-- package.json
```

---

## Dependencias principais

| Pacote | Uso |
|--------|-----|
| `express` | Framework HTTP |
| `mysql2` | Conexao com MySQL |
| `bcryptjs` | Hash de senhas |
| `nodemailer` | Envio de e-mails (SMTP) |
| `dotenv` | Variaveis de ambiente |
| `nodemon` | Reinicio automatico (dev) |

---

## Deploy no Render

O projeto ja esta preparado com o arquivo `render.yaml`.

1. Acesse [render.com](https://render.com) e conecte seu repositorio do GitHub
2. Escolha **Web Service** usando o `render.yaml`
3. Configure as variaveis de ambiente (`DB_*`, `MAIL_*`, `APP_URL`) no painel do Render
4. Faca o deploy

> Defina `APP_URL` com a URL publica do Render (ex: `https://intellistock.onrender.com`) para que os links de recuperacao de senha funcionem corretamente.

---

## Licenca

ISC