"""REV-18: kiểm thử nhanh cho ai_pr_tester.py (chạy: python -m unittest .github/scripts/test_ai_pr_tester.py)."""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_pr_tester as t  # noqa: E402


class ResolvePullRequestTest(unittest.TestCase):
    def test_khong_fallback_data0_khi_sha_khong_khop(self):
        other_pr = {"number": 7, "head": {"sha": "bbb"}}
        with mock.patch.object(t, "gh_api", return_value=([other_pr], None)):
            pr, err = t.resolve_pull_request("o/r", "tok", "", "aaa", "feature", "evil/r")
        self.assertIsNone(pr)
        self.assertTrue(err)

    def test_khop_sha_thi_tra_ve_pr(self):
        good = {"number": 9, "head": {"sha": "aaa"}}
        with mock.patch.object(t, "gh_api", return_value=([{"number": 1, "head": {"sha": "x"}}, good], None)):
            pr, err = t.resolve_pull_request("o/r", "tok", "", "aaa", "feature", "evil/r")
        self.assertEqual(pr, good)
        self.assertIsNone(err)


class ForkDetectionTest(unittest.TestCase):
    def test_fork(self):
        self.assertTrue(t.is_fork_pr("o/r", "evil/r"))
        self.assertTrue(t.is_fork_pr("o/r", "o/r", {"head": {"repo": None}}))
        self.assertTrue(t.is_fork_pr("o/r", "", {"head": {"repo": {"full_name": "evil/r"}}}))

    def test_cung_repo(self):
        self.assertFalse(t.is_fork_pr("o/r", "O/R", {"head": {"repo": {"full_name": "o/r"}}}))


class ForkFailureFlowTest(unittest.TestCase):
    ENV = {
        "GITHUB_TOKEN": "tok",
        "REPOSITORY": "o/r",
        "HEAD_REPO": "evil/r",
        "HEAD_SHA": "aaa",
        "HEAD_BRANCH": "feature",
        "WORKFLOW_CONCLUSION": "failure",
        "CI_ARTIFACT_DIR": "khong-ton-tai",
        "GEMINI_API_KEY": "g",
        "JIRA_USER_EMAIL": "a@b.c",
        "JIRA_API_TOKEN": "jt",
    }

    def test_pr_fork_that_bai_khong_tao_jira_khong_goi_gemini_khong_chen_log(self):
        pr = {"number": 5, "title": "t", "body": "", "user": {"login": "evil"},
              "head": {"sha": "aaa", "ref": "feature", "repo": {"full_name": "evil/r"}}}
        posted = []
        with mock.patch.dict(os.environ, self.ENV, clear=True), \
                mock.patch.object(t, "resolve_pull_request", return_value=(pr, None)), \
                mock.patch.object(t, "read_ci_outcomes", return_value={"backend_tests": "failure"}), \
                mock.patch.object(t, "read_log_file", return_value="LOG-DO-NGUOI-NGOAI-VIET") as read_log, \
                mock.patch.object(t, "create_jira_issue") as jira, \
                mock.patch.object(t, "call_gemini") as gemini, \
                mock.patch.object(t, "analyze_test_failure_with_gemini") as analyze, \
                mock.patch.object(t, "post_github_comment", side_effect=lambda r, n, tk, body: posted.append(body) or True):
            with self.assertRaises(SystemExit):
                t.main()
        jira.assert_not_called()
        gemini.assert_not_called()
        analyze.assert_not_called()
        read_log.assert_not_called()
        self.assertEqual(len(posted), 1)
        self.assertNotIn("LOG-DO-NGUOI-NGOAI-VIET", posted[0])
        self.assertNotIn("@evil", posted[0])
        self.assertIn("Backend Unit Tests", posted[0])


if __name__ == "__main__":
    unittest.main()
