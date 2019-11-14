import jsonwebtoken from 'jsonwebtoken';

// const APIError = (code, message) {
//   this.code = code || 'internal:unknown_error'
//   this.message = message || ''
// }

const restify = (pathPrefix) => {

  pathPrefix = pathPrefix || '/api/';

  return async(ctx, next) => {

    if (ctx.req)

  }

}