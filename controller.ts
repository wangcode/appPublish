import fs from 'fs';
import Router from 'koa-router';

const router = new Router();

const main = () => {

  let files = fs.readdirSync('./controllers')

  let js_files = files.filter((f) => {
    return f.endsWith('.js')
  })

  for (let f of js_files) {

    console.log(`process controller: ${f}...`)
    let mapping = require('./controllers/' + f)
    console.log(mapping)
    // router.map(mapping)

  }

}


main()


export default router