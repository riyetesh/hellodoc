const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if ((entry.isFile() && entry.name.endsWith('.html')) || (entry.isDirectory() && ['Styles','Scripts','Asset','images','Waiting page'].includes(entry.name))) {
    fs.cpSync(path.join(root,entry.name),path.join(output,entry.name),{recursive:true,filter:(src) => !path.basename(src).startsWith('.')});
  }
}
console.log('Static HelloDoc pages built to dist; backend, secrets and experimental models excluded.');
