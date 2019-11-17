import Router from 'koa-router';
import fs from 'fs';

const router = new Router();

const main = () => {

  let files = fs.readdirSync('./controllers')
  let js_files = files.filter((f) => f.endsWith('.js'))

  for (var f of js_files) {
    console.log(`process controller: ${f}...`)
    let mapping = require('./controllers/' + f)
    console.log(mapping)
    // router.map(mapping)
  }

}

export default router