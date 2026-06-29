exports.handler = async (req, res) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, msg: "Vercel works!" })
  };
};
