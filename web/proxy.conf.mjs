// ng serve proxy. Mirrors deploy/nginx/app.conf.template: /api/v1/* is one
// URL space split by method (GET/HEAD and their CORS preflights to the Go
// read-api, writes to the Rails write-api), and /admin goes to Rails.
const READ_API = 'http://localhost:8080';
const WRITE_API = 'http://localhost:3000';

const isRead = (req) => {
  const method = req.method === 'OPTIONS' ? req.headers['access-control-request-method'] || 'GET' : req.method;
  return method === 'GET' || method === 'HEAD';
};

export default {
  '/api/v1': {
    target: READ_API,
    secure: false,
    // Vite calls proxy.web(req, res, options) per request; pick the target there.
    configure: (proxy) => {
      const web = proxy.web.bind(proxy);
      proxy.web = (req, res, options = {}, ...rest) =>
        web(req, res, { ...options, target: isRead(req) ? READ_API : WRITE_API }, ...rest);
    },
  },
  '/admin': {
    target: WRITE_API,
    secure: false,
  },
};
