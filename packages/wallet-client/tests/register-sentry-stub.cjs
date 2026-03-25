const Module = require('module')

const originalLoad = Module._load

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@sentry/nextjs') {
    return {
      captureException() {
        return undefined
      }
    }
  }

  return originalLoad.call(this, request, parent, isMain)
}
