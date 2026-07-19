// Sample vulnerable client-side JS for testing JS Analyzer Agent v0.1.
// Planted issues: aliased DOM-XSS, direct DOM-XSS, open redirect,
// postMessage->eval, prototype-pollution merge, hardcoded secrets
// (one sensitive + one public), plus a safe sink that must NOT flag.
(function () {
  // [dom-xss / aliased] location.hash -> innerHTML through a variable
  var q = decodeURIComponent(location.hash.slice(1));
  document.getElementById('out').innerHTML = q;

  // [dom-xss / direct] location.search flows straight into document.write
  document.write(location.search);

  // [open-redirect / aliased] user-controlled ?next= into location.href
  var next = new URLSearchParams(location.search).get('next');
  location.href = next;

  // [postmessage] listener with no origin check, event.data into eval
  window.addEventListener('message', function (event) {
    eval(event.data);
  });

  // [proto-pollution] recursive merge copying attacker-controlled keys
  function merge(dst, src) {
    for (var k in src) {
      if (typeof src[k] === 'object') {
        merge(dst[k], src[k]);
      } else {
        dst[k] = src[k];
      }
    }
    return dst;
  }
  window.__merge = merge;

  // [secret / sensitive] hardcoded AWS access key
  var AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
  // [secret / public] Stripe publishable key — must be classified public, not a vuln
  var STRIPE_PUB = "pk_live_51H8xExampleExampleExampleExample1234";

  // [safe negative] textContent is not an XSS sink — must NOT be flagged
  document.getElementById('safe').textContent = q;

  // [asset] exposed admin API endpoint + param
  fetch('/api/v1/admin/users?role=admin&debug=true');
})();
