// External script (discovered via network response).
// DOM-XSS: location.hash flows into innerHTML.
var h = decodeURIComponent(location.hash.slice(1));
document.getElementById('app').innerHTML = h;
