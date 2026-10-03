/* www.whiterabbitai.org -> whiterabbitai.org, keeping the path and query. */
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'whiterabbitai.org';
    return Response.redirect(url.toString(), 301);
  },
};
