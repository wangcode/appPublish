class ParameterWrapper {

  static wrapType(type: string) {
    type = type.toLowerCase()
    switch (type) {
      case 'boolean':
      case 'integer':
        return type
      case 'double':
        return 'number'
      case 'arrays':
        return 'array'
      default:
        return 'string'
    }
  }

  static wrapper = (parameters: any) => {
    Object.getOwnPropertyNames(parameters)
      .map( key => {
        if(parameters[key] instanceof Array) {

          let item = parameters[key][0]

          ParameterWrapper.wrapper(item)

          parameters[key] = {
            type: 'array',
            items: { properties: item }
          }

        } else if (parameters[key] instanceof Object) {

          let object = parameters[key]
          let type = object['type']

          if (type && type['name']) {

            parameters[key]['type'] = ParameterWrapper.wrapType(type['name'])

          } else {

            if (parameters[key] instanceof Function) {

              parameters[key] = { type: ParameterWrapper.wrapType(parameters[key]['name']) }

            } else {

              let item = parameters[key]

              ParameterWrapper.wrapper(item)

              parameters[key] = {
                type: 'object',
                properties: item
              }

            }

          }

        }

      })
  }

}

export default ParameterWrapper