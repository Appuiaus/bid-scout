-- Phase 1 source: SAM.gov Get Opportunities public API (official, free).
-- NAICS: 238910 site prep, 237310 highway/street, 237110 water/sewer, 237990 other heavy civil.
INSERT INTO boards (board_id, board_name, access_type, endpoint, search_parameter_mapping, enabled)
VALUES ('samgov', 'SAM.gov (federal)', 'api', 'https://api.sam.gov/opportunities/v2/search',
        '{"naics":["238910","237310","237110","237990"],"lookback_days":3}', 1);

INSERT INTO credentials (board_id, account_owner, login_url, secret_reference, two_factor_type)
VALUES ('samgov', 'ben', 'https://sam.gov/profile/details', 'SAM_API_KEY', 'login.gov');
