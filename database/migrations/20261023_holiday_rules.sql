SET LOCAL lock_timeout = '5s';
CREATE TABLE holiday_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  month INTEGER CHECK (month BETWEEN 1 AND 12),
  day INTEGER CHECK (day BETWEEN 1 AND 31),
  movable_rule TEXT CHECK (movable_rule IN ('good_friday','carnival_tuesday','corpus_christi')),
  scope TEXT NOT NULL CHECK (scope IN ('nacional','estadual','municipal')),
  classification TEXT NOT NULL CHECK (classification IN ('feriado_legal','ponto_facultativo','data_comemorativa','folga_empresa')),
  legal_basis TEXT,
  no_work BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((movable_rule IS NULL AND month IS NOT NULL AND day IS NOT NULL) OR (movable_rule IS NOT NULL AND month IS NULL AND day IS NULL))
);
INSERT INTO holiday_rules (code,name,month,day,movable_rule,scope,classification,legal_basis,no_work) VALUES
('new_year','Confraternização Universal',1,1,NULL,'nacional','feriado_legal','Lei federal 662/1949',TRUE),
('tiradentes','Tiradentes',4,21,NULL,'nacional','feriado_legal','Lei federal 4.897/1965',TRUE),
('labour','Dia do Trabalho',5,1,NULL,'nacional','feriado_legal','Lei federal 662/1949',TRUE),
('independence','Independência do Brasil',9,7,NULL,'nacional','feriado_legal','Lei federal 662/1949',TRUE),
('aparecida','Nossa Senhora Aparecida',10,12,NULL,'nacional','feriado_legal','Lei federal 6.802/1980',TRUE),
('souls','Finados',11,2,NULL,'nacional','feriado_legal','Lei federal 10.607/2002',TRUE),
('republic','Proclamação da República',11,15,NULL,'nacional','feriado_legal','Lei federal 662/1949',TRUE),
('conscience','Dia Nacional de Zumbi e da Consciência Negra',11,20,NULL,'nacional','feriado_legal','Lei federal 14.759/2023; Lei estadual MT 7.879/2002',TRUE),
('christmas','Natal',12,25,NULL,'nacional','feriado_legal','Lei federal 662/1949',TRUE),
('peixoto_anniversary','Aniversário de Peixoto de Azevedo',5,13,NULL,'municipal','feriado_legal','Feriado confirmado pela Câmara Municipal; número da lei instituidora pendente de conferência',TRUE),
('miner','Dia do Garimpeiro',7,21,NULL,'municipal','feriado_legal','Lei municipal 817/2011; confirmar texto integral quanto ao feriado',TRUE),
('good_friday','Sexta-feira Santa — Paixão de Cristo',NULL,NULL,'good_friday','municipal','folga_empresa','Folga concedida pela empresa; Lei federal 9.093/1995, art. 2º (feriado religioso depende de lei municipal)',TRUE),
('carnival','Carnaval (terça-feira)',NULL,NULL,'carnival_tuesday','nacional','ponto_facultativo','Ponto facultativo no serviço público; sem efeito automático na empresa',FALSE),
('corpus','Corpus Christi',NULL,NULL,'corpus_christi','estadual','ponto_facultativo','Decreto estadual MT 1.787/2025 apenas para repartições públicas em 2026; sem efeito automático na empresa',FALSE);
