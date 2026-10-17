const run = (conn, sql, params = []) => new Promise((resolve, reject) => {
  conn.query(sql, params, (error, result) => error ? reject(error) : resolve(result));
});

async function withTransaction(pool, work) {
  const conn = await new Promise((resolve, reject) => pool.getConnection((error, connection) => error ? reject(error) : resolve(connection)));
  try {
    await new Promise((resolve, reject) => conn.beginTransaction((error) => error ? reject(error) : resolve()));
    const result = await work(conn);
    await new Promise((resolve, reject) => conn.commit((error) => error ? reject(error) : resolve()));
    return result;
  } catch (error) {
    await new Promise((resolve) => conn.rollback(resolve));
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { run, withTransaction };
