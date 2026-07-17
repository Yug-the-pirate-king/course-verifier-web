# AI Fix — Issue #5: Security: Review and sanitize inputs

**Issue body:**

This is an automated issue created by the AI agent to track planned code quality improvements. The AI will fix this in a subsequent run.

---

**AI-proposed fix:**

I don’t have direct access to the `Yug-the-pirate-king/course-verifier-web` codebase, so the paths below are **representative of a typical course-verifier web app**. Map them to your actual project structure.

## Root Cause

User-supplied data is likely being rendered directly into the DOM or passed to the backend without validation/sanitization. This allows:

- **Reflected/DOM-based XSS** if input is echoed into HTML/URLs.
- **Command/SQL/NoSQL injection** if inputs are concatenated into queries or shell commands.
- **Open redirects or unsafe URL handling** if untrusted URLs are used as `href`/`src`.

## Exact Code Changes Needed

### 1. Client-side input sanitization before rendering

**Likely file:** `src/app.js` or `static/js/main.js`

**Current pattern (vulnerable):**
```js
document.getElementById('result').innerHTML = userInput;
```

**Safe pattern:**
```js
import DOMPurify from 'dompurify';

function renderUserInput(input) {
  const safe = DOMPurify.sanitize(input, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br'],
    ALLOWED_ATTR: []
  });
  document.getElementById('result').textContent = safe; // prefer textContent for plain text
}
```

If you only need text, use `textContent` and skip HTML entirely.

---

### 2. Validate all form inputs before processing

**Likely file:** `src/validation.js` or `js/validation.js`

```js
export function validateCourseCode(code) {
  if (typeof code !== 'string') return null;
  const normalized = code.trim();
  // Only allow alphanumeric, dash, underscore, max 20 chars
  const re = /^[A-Za-z0-9_-]{1,20}$/;
  return re.test(normalized) ? normalized : null;
}
```

Use it before any API call:

```js
const courseCode = document.getElementById('course-code').value;
const validCode = validateCourseCode(courseCode);
if (!validCode) {
  showError('Invalid course code');
  return;
}
```

---

### 3. Server-side sanitization/validation

**Likely file:** `server.js` or `api/index.js` (Node/Express)

Install dependencies:
```bash
npm install express-validator dompurify jsdom
```

```js
const { body, validationResult } = require('express-validator');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const DOMPurify = createDOMPurify(new JSDOM('').window);

const courseValidation = [
  body('courseCode')
    .trim()
    .isLength({ min: 1, max: 20 })
    .matches(/^[A-Za-z0-9_-]+$/)
    .withMessage('Invalid course code')
];

app.post('/api/verify', courseValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const courseCode = DOMPurify.sanitize(req.body.courseCode, { ALLOWED_TAGS: [] });

  // Now safely use courseCode in business logic
  ...
});
```

---

### 4. Sanitize URL inputs

**Likely file:** `src/utils.js` or `js/verify.js`

```js
export function isValidCourseUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.example.edu');
  } catch {
    return false;
  }
}
```

Never use `eval`, `innerHTML`, or shell interpolation with untrusted values.

---

### 5. If database access exists, use parameterized queries

**Likely file:** `db/queries.js` or `models/course.js`

```js
// Bad
db.query(`SELECT * FROM courses WHERE code = '${code}'`);

// Good
db.query('SELECT * FROM courses WHERE code = ?', [code]);
```

## Follow-up Actions

1. **Identify all input surfaces:** search the repo for `.innerHTML`, `document.write`, `eval(`, `new Function(`, `exec(`, `.query(`, and `req.body`.
2. **Replace output sinks:** switch from `innerHTML` to `textContent` wherever HTML isn’t required.
3. **Add tests:** add unit tests for validation/sanitization, including XSS payloads like `<img src=x onerror=alert(1)>`.
4. **Run security scanners:** use `npm audit`, `semgrep`, or `CodeQL` on the repository.
5. **Consider CSP:** add a Content Security Policy header to block inline scripts:
   ```http
   Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'
   ```
6. **Open a PR** referencing issue #5 with the above changes and request a security review.

If you can share the actual file tree or paste the relevant files, I can provide **repo-specific diffs and exact file paths**.
