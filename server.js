const express = require("express");
const cors = require("cors");
const path = require("path");
const app = express();
//const PDFDocument = require("pdfkit");
const fs = require("fs");
const multer = require("multer");

const { PDFDocument, StandardFonts, rgb  } = require("pdf-lib");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB por archivo
    files: 20,
    fieldSize: 20 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/jpg",
      "image/gif",
      "image/bmp",
      "image/tiff"
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);   // ✔ aceptar archivo
    } else {
      cb(null, false);  // ❌ rechazar archivo
    }
  }
});

//const { PDFDocument: PDFLibDocument } = require("pdf-lib");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
//const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const Mailjet = require('node-mailjet');
// Almacenamiento temporal en memoria


app.use(cors());
app.use(express.json());
app.use(express.static("public")); // servir login, formulario, encabezado, etc.


// Pool PostgreSQL (Render)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);

app.use(session({
  store: new PgSession({
    pool: pool, // tu pool de PostgreSQL
    tableName: "session"
  }),
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // en Render con HTTPS se puede poner true
    maxAge: 1000 * 60 * 60 * 2 // 2 horas
  }
}));

function requireLogin(req, res, next) {
  if (!req.session.username) {
    return res.redirect("/index.html");
  }
  next();
}

const mailjet = Mailjet.apiConnect(
  process.env.MJ_USER,
  process.env.MJ_PASS
);


app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM operarios_facturas WHERE username = $1",
    [username]
  );
  console.log("BODY:", req.body);
  console.log("USER:", username);
  console.log("HASH:", username.pass_hash);

  if (result.rows.length === 0) {
    return res.redirect("/index.html?error=1");
  }

  const user = result.rows[0];

  const ok = await bcrypt.compare(password, user.pass_hash);

  if (!ok) {
    return res.redirect("/index.html?error=1");
  }

  req.session.username = user.username;
  req.session.nombre = user.nombre;
  req.session.empresa = user.empresa; // NUEVO
  req.session.rol = user.rol;         // NUEVO

  res.redirect("/menu.html");
});


app.get("/formulario.html", requireLogin, (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "formulario.html"));
});

app.get("/api/me", (req, res) => {
  res.json({ username: req.session.username,empresa: req.session.empresa,rol: req.session.rol });
  pdfsTemporales = [];

  
});
function esAdmin(req) {
  return req.session && req.session.rol === "admin";
}

app.get("/api/xml/:id", requireLogin, async (req, res) => {
  try {
    const xmlId = req.params.id;

    const sql = `
      SELECT xml_content, factura_id
      FROM xml_facturas
      WHERE id = $1
    `;

    const result = await pool.query(sql, [xmlId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "XML no encontrado" });
    }

    const { xml_content, factura_id } = result.rows[0];

    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename=factura_${factura_id}.xml`);
    return res.send(xml_content);

  } catch (err) {
    console.error("❌ Error descargando XML:", err);
    res.status(500).json({ error: "Error descargando XML" });
  }
});


app.get("/historial", async (req, res) => {
    let { cliente, fecha_libramiento, fecha_vencimiento } = req.query;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    let where = [];
    let params = [];

    if (cliente && cliente.trim() !== "") {
        params.push(cliente.trim());
        where.push(`cliente = $${params.length}`);
    }

    if (fecha_libramiento && fecha_libramiento.trim() !== "") {
        params.push(fecha_libramiento);
        where.push(`fecha_libramiento = $${params.length}`);
    }

    if (fecha_vencimiento && fecha_vencimiento.trim() !== "") {
        params.push(fecha_vencimiento);
        where.push(`fecha_vencimiento = $${params.length}`);
    }

    if (where.length === 0) {
        return res.status(400).json({ error: "Debe indicar cliente, libramiento o vencimiento" });
    }

    const whereSQL = "WHERE " + where.join(" AND ");

    const query = `
        SELECT id, num_factura, cliente, importe, cuenta_bancaria, fecha_libramiento, fecha_vencimiento
        FROM facturas_baezcan
        ${whereSQL}
        ORDER BY fecha_libramiento DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const countQuery = `
        SELECT COUNT(*) AS total
        FROM facturas_baezcan
        ${whereSQL}
    `;

    try {
        const result = await pool.query(query, [...params, limit, offset]);
        const total = await pool.query(countQuery, params);

        res.json({
            datos: result.rows,
            total: parseInt(total.rows[0].total),
            page,
            limit
        });

    } catch (err) {
        console.error("❌ ERROR EN /historial:", err);
        res.status(500).json({ error: "Error en la base de datos" });
    }
});




app.get("/api/generarXML/:id", requireLogin, async (req, res) => {
  try {
    if (!req.session || !req.session.username) {
      return res.status(401).json({ error: "Sesión caducada" });
    }

    const facturaId = req.params.id;

    // 1. Obtener datos de la factura
    const sql = `
      SELECT num_factura, cliente, importe, cuenta_bancaria
      FROM facturas_baezcan
      WHERE id = $1
    `;
    const result = await pool.query(sql, [facturaId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    const f = result.rows[0];

    // 2. Generar XML
    const xml = `
<?xml version="1.0" encoding="UTF-8"?>
<Factura>
  <Numero>${f.num_factura}</Numero>
  <Cliente>${f.cliente}</Cliente>
  <Importe>${f.importe}</Importe>
  <CuentaBancaria>${f.cuenta_bancaria}</CuentaBancaria>
</Factura>
    `.trim();

    // 3. Guardar XML en la BD
    await pool.query(
      `INSERT INTO xml_facturas (factura_id, xml_content) VALUES ($1, $2)`,
      [facturaId, xml]
    );

    // 4. Enviar XML como archivo descargable
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename=factura_${facturaId}.xml`);
    return res.send(xml);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error al generar XML");
  }
});

app.get("/api/xmlHistorial", requireLogin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT x.id, x.factura_id, x.fecha_generado, f.num_factura, f.cliente
      FROM xml_facturas x
      JOIN facturas_baezcan f ON f.id = x.factura_id
      ORDER BY x.fecha_generado DESC
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo historial XML" });
  }
});



// Ruta para insertar datos
app.post("/api/insert", requireLogin, async (req, res) => {
  try {
    if (!req.session || !req.session.username) {
      return res.status(401).json({ error: "Sesión caducada" });
    }
    const d = req.body;
    
      const sql = `
        INSERT INTO facturas_baezcan (
          num_factura,cliente,importe,cuenta_bancaria,fecha_libramiento,fecha_vencimiento
        ) VALUES (
          $1,$2,$3,$4,$5,$6
        )
        RETURNING id;
      `;

      const values = [
        d.num_factura, d.cliente, d.importe, d.cuenta_bancaria,d.fecha_libramiento,d.fecha_vencimiento
      ];

      const result = await pool.query(sql, values);
      return res.json({ status: "OK", id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error al insertar");
  }
});


async function enviarCorreo(pdfBuffer, filename, operario,maquina,empresa) {
  try {
    // Normalizamos para comparar
    const emp = (empresa || "").toLowerCase();
    
    // Correos por defecto (Baezcan)
    let destinatarios = [
      { Email: "administracion@grupobaezcan.com" },
        { Email: "gestionbaezcan@gmail.com" },
        { Email: "informes@grupobaezcan.com" }
    ];

    // Si la empresa es TITSA
/*if (emp.includes("titsa")) {
      destinatarios = [
        { Email: "raulglezespino@gmail.com" },
        { Email: "administracion@grupobaezcan.com" },
      { Email: "gestionbaezcan@gmail.com" },
      { Email: "grupobaezcan@gmail.com" },
      { Email: "informes@grupobaezcan.com" }
      ];
   }
*/
    // Si la empresa es GLOBAL
    if (emp.includes("global")) {
      destinatarios = [
        { Email: "ogonzalez@guaguasglobal.com" },
        { Email: "administracion@grupobaezcan.com" },
        { Email: "gestionbaezcan@gmail.com" },
        { Email: "informes@grupobaezcan.com" }
      ];
    }

    await mailjet
      .post("send", { version: "v3.1" })
      .request({
        Messages: [
          {
            From: {
              Email: "informes@grupobaezcan.com",
              Name: "Grupo Baezcan"
            },
            To: destinatarios,
            Subject: `Informe diario - ${operario}`,
            HTMLPart: `
              <p>Hola,</p>
              <p>Adjunto el informe de maquinaria <strong>${maquina}</strong> del operario <strong>${operario}</strong>.</p>
              <p>Saludos,<br>Grupo Baezcan</p>
            `,
            Attachments: [
              {
                ContentType: "application/pdf",
                Filename: filename,
                Base64Content: Buffer.from(pdfBuffer).toString("base64")
              }
            ]
          }
        ]
      });

    console.log("Correo enviado correctamente");
  } catch (err) {
    console.error("Error enviando correo:", err);
  }
}


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor escuchando en el puerto " + PORT);
});

