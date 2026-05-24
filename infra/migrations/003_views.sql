CREATE OR REPLACE VIEW published_passages AS
SELECT *
FROM passages
WHERE license_status = 'cc_compatible';

CREATE OR REPLACE VIEW published_nodes AS
SELECT *
FROM semantic_nodes
WHERE license_status = 'cc_compatible';

