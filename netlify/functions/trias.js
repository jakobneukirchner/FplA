// Netlify Serverless Function – leitet TRIAS-Anfragen weiter und injiziert den API-Key
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const key = process.env.TRIAS_KEY;
  if (!key) return { statusCode: 500, body: 'TRIAS_KEY not configured' };

  // Key in den XML-Body injizieren
  const body = (event.body || '').replace(
    /<ns2:RequestorRef>[^<]*<\/ns2:RequestorRef>/,
    `<ns2:RequestorRef>${key}</ns2:RequestorRef>`
  );

  try {
    const response = await fetch('https://v4-api.efa.de/trias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body
    });
    const text = await response.text();
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/xml', 'Access-Control-Allow-Origin': '*' },
      body: text
    };
  } catch (e) {
    return { statusCode: 502, body: 'TRIAS upstream error: ' + e.message };
  }
};
