/**
 * init swagger definitions
 * @param {String} title
 * @param {String} description
 * @param {String} version
 * @param {Object} options other options for swagger definition
 */

const definitions = ( title: string = 'API DOC', description: string = 'API DOC', version: string = '1.0.0', options = {} ) => {
  return Object.assign(
    {
      info: { title, description, version },
      paths: {},
      responses: {},
    },
    {
      definitions: {},
      tags: [],
      swagger: '2.0',
      securityDefinitions: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization'
        }
      },
    },
    options,
  )
}

export default definitions